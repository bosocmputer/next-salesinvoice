package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

// HTTPRequestsTotal counts HTTP requests labeled by method, route, and status.
var HTTPRequestsTotal = promauto.NewCounterVec(
	prometheus.CounterOpts{
		Name: "nsi_http_requests_total",
		Help: "Total number of HTTP requests handled by the API server.",
	},
	[]string{"method", "route", "status"},
)

// HTTPRequestDurationSeconds measures HTTP request latency in seconds.
var HTTPRequestDurationSeconds = promauto.NewHistogramVec(
	prometheus.HistogramOpts{
		Name:    "nsi_http_request_duration_seconds",
		Help:    "Histogram of HTTP request latency in seconds.",
		Buckets: prometheus.DefBuckets,
	},
	[]string{"method", "route"},
)

// LoginAttemptsTotal counts login attempts by outcome.
// result is one of: "success", "invalid", "forbidden", "rate_limited", "error".
var LoginAttemptsTotal = promauto.NewCounterVec(
	prometheus.CounterOpts{
		Name: "nsi_login_attempts_total",
		Help: "Total number of login attempts grouped by result.",
	},
	[]string{"result"},
)

// BulkApplyDocumentsTotal counts documents processed by bulk apply by outcome.
var BulkApplyDocumentsTotal = promauto.NewCounterVec(
	prometheus.CounterOpts{
		Name: "nsi_bulk_apply_documents_total",
		Help: "Total number of documents touched by bulk apply, by outcome.",
	},
	[]string{"outcome"},
)

// ClientEventsTotal counts client telemetry events by kind.
var ClientEventsTotal = promauto.NewCounterVec(
	prometheus.CounterOpts{
		Name: "nsi_client_events_total",
		Help: "Total client telemetry events received, grouped by kind.",
	},
	[]string{"kind"},
)

// WriteRateLimitedTotal counts rate-limit rejections on write endpoints, by route.
var WriteRateLimitedTotal = promauto.NewCounterVec(
	prometheus.CounterOpts{
		Name: "nsi_write_rate_limited_total",
		Help: "Total write requests rejected by per-user/IP rate limiter, grouped by route.",
	},
	[]string{"route"},
)
