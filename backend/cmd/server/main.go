package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"next-salesinvoice/backend/internal/appruntime"
	"next-salesinvoice/backend/internal/config"
	apphttp "next-salesinvoice/backend/internal/http"
	"next-salesinvoice/backend/internal/session"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("load config: %v", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	sessionManager := session.NewManager(cfg.SessionSecret, 8*time.Hour)
	state, err := appruntime.New(ctx, cfg, sessionManager)
	if err != nil {
		log.Fatalf("initialize runtime: %v", err)
	}
	defer state.Close()

	router := apphttp.NewRouter(cfg, state, sessionManager)
	server := &http.Server{
		Addr:              cfg.ServerAddr,
		Handler:           router,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("next-salesinvoice backend listening on %s", cfg.ServerAddr)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server error: %v", err)
		}
	}()

	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Printf("server shutdown error: %v", err)
	}
}
