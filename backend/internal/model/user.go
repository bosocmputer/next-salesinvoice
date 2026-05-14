package model

type ERPUser struct {
	Code        string `json:"code"`
	Name1       string `json:"name1"`
	Name2       string `json:"name2"`
	Password    string `json:"-"`
	Status      int16  `json:"status"`
	IsLoginUser int16  `json:"isLoginUser"`
	BranchCode  string `json:"branchCode"`
	Title       string `json:"title"`
}

func (u ERPUser) DisplayName() string {
	if u.Name1 != "" {
		return u.Name1
	}
	if u.Name2 != "" {
		return u.Name2
	}
	return u.Code
}

type AppUser struct {
	ID          int64  `json:"id"`
	ERPUserCode string `json:"erpUserCode"`
	DisplayName string `json:"displayName"`
	Role        string `json:"role"`
	IsActive    bool   `json:"isActive"`
}
