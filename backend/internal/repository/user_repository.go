package repository

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"next-salesinvoice/backend/internal/config"
	"next-salesinvoice/backend/internal/model"
)

var ErrNotFound = errors.New("not found")

type ERPUserRepository struct {
	pool *pgxpool.Pool
	cfg  config.Config
}

func NewERPUserRepository(pool *pgxpool.Pool, cfg config.Config) *ERPUserRepository {
	return &ERPUserRepository{pool: pool, cfg: cfg}
}

func (r *ERPUserRepository) FindByCode(ctx context.Context, code string) (model.ERPUser, error) {
	queryCtx, cancel := context.WithTimeout(ctx, r.cfg.DBQueryTimeout)
	defer cancel()

	var user model.ERPUser
	err := r.pool.QueryRow(queryCtx, `
		select
			code,
			coalesce(name_1, ''),
			coalesce(name_2, ''),
			coalesce(password, ''),
			coalesce(status, 0),
			coalesce(is_login_user, 0),
			coalesce(branch_code, ''),
			coalesce(title, '')
		from erp_user
		where code = $1
	`, code).Scan(&user.Code, &user.Name1, &user.Name2, &user.Password, &user.Status, &user.IsLoginUser, &user.BranchCode, &user.Title)
	if errors.Is(err, pgx.ErrNoRows) {
		return model.ERPUser{}, ErrNotFound
	}
	if err != nil {
		return model.ERPUser{}, fmt.Errorf("find erp user: %w", err)
	}
	return user, nil
}

type AppUserRepository struct {
	pool *pgxpool.Pool
	cfg  config.Config
}

func NewAppUserRepository(pool *pgxpool.Pool, cfg config.Config) *AppUserRepository {
	return &AppUserRepository{pool: pool, cfg: cfg}
}

func (r *AppUserRepository) FindOrProvision(ctx context.Context, erpUser model.ERPUser) (model.AppUser, error) {
	queryCtx, cancel := context.WithTimeout(ctx, r.cfg.DBQueryTimeout)
	defer cancel()

	tx, err := r.pool.Begin(queryCtx)
	if err != nil {
		return model.AppUser{}, fmt.Errorf("begin app user provision: %w", err)
	}
	defer tx.Rollback(queryCtx)

	var appUser model.AppUser
	expectedRole := roleFromERPTitle(erpUser.Title)
	err = tx.QueryRow(queryCtx, `
		select id, erp_user_code, display_name, role, is_active
		from nsi_app_users
		where erp_user_code = $1
	`, erpUser.Code).Scan(&appUser.ID, &appUser.ERPUserCode, &appUser.DisplayName, &appUser.Role, &appUser.IsActive)
	if err == nil {
		if appUser.Role != expectedRole || appUser.DisplayName != erpUser.DisplayName() {
			if err := tx.QueryRow(queryCtx, `
				update nsi_app_users
				set display_name = $2,
					role = $3,
					updated_at = now()
				where erp_user_code = $1
				returning id, erp_user_code, display_name, role, is_active
			`, erpUser.Code, erpUser.DisplayName(), expectedRole).Scan(
				&appUser.ID, &appUser.ERPUserCode, &appUser.DisplayName, &appUser.Role, &appUser.IsActive,
			); err != nil {
				return model.AppUser{}, fmt.Errorf("sync app user role: %w", err)
			}
		}
		return appUser, tx.Commit(queryCtx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return model.AppUser{}, fmt.Errorf("find app user: %w", err)
	}

	err = tx.QueryRow(queryCtx, `
		insert into nsi_app_users (erp_user_code, display_name, role, is_active)
		values ($1, $2, $3, true)
		returning id, erp_user_code, display_name, role, is_active
	`, erpUser.Code, erpUser.DisplayName(), expectedRole).Scan(
		&appUser.ID, &appUser.ERPUserCode, &appUser.DisplayName, &appUser.Role, &appUser.IsActive,
	)
	if err != nil {
		return model.AppUser{}, fmt.Errorf("insert app user: %w", err)
	}
	if err := tx.Commit(queryCtx); err != nil {
		return model.AppUser{}, fmt.Errorf("commit app user provision: %w", err)
	}
	return appUser, nil
}

func roleFromERPTitle(title string) string {
	if strings.EqualFold(strings.TrimSpace(title), "admin") {
		return "Admin"
	}
	return "User"
}
