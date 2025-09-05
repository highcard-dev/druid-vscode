package main

import (
	"log"
	"net/http"
	"os"

	"golang.org/x/net/webdav"
)

func main() {
	// Directory to serve
	dir := "./data"
	if err := os.MkdirAll(dir, 0755); err != nil {
		log.Fatal(err)
	}

	// Create WebDAV handler
	handler := &webdav.Handler{
		Prefix:     "/",
		FileSystem: webdav.Dir(dir),
		LockSystem: webdav.NewMemLS(),
	}

	// Add CORS and handle requests
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Add CORS headers to allow requests from everywhere
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PROPFIND, PROPPATCH, MKCOL, COPY, MOVE, LOCK, UNLOCK")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, Depth, Destination, If, Lock-Token, Overwrite, Timeout")
		w.Header().Set("Access-Control-Expose-Headers", "DAV, ETag, Lock-Token")

		// Handle preflight OPTIONS requests
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		handler.ServeHTTP(w, r)
	})

	log.Println("WebDAV server running on :8011")
	log.Fatal(http.ListenAndServe(":8011", nil))
}
