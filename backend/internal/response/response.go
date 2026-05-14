package response

import "github.com/gin-gonic/gin"

type ErrorDetail struct {
	Code   string `json:"code"`
	Detail string `json:"detail"`
}

type Body struct {
	Success bool         `json:"success"`
	Message string       `json:"message"`
	Data    any          `json:"data"`
	Error   *ErrorDetail `json:"error"`
}

func OK(c *gin.Context, status int, message string, data any) {
	c.JSON(status, Body{Success: true, Message: message, Data: data, Error: nil})
}

func Error(c *gin.Context, status int, code, message, detail string) {
	c.JSON(status, Body{
		Success: false,
		Message: message,
		Data:    nil,
		Error:   &ErrorDetail{Code: code, Detail: detail},
	})
}
