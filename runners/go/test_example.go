// Example Go program to test compilation and execution
package main

import (
    "fmt"
    "os"
)

func main() {
    fmt.Println("Hello from Go!")
    
    // Test command line arguments
    if len(os.Args) > 1 {
        fmt.Printf("Arguments received: %v\n", os.Args[1:])
    }
    
    // Test file operations
    err := os.WriteFile("outputs/test.txt", []byte("Go can write files!"), 0644)
    if err != nil {
        fmt.Fprintf(os.Stderr, "Error writing file: %v\n", err)
        os.Exit(1)
    }
    
    fmt.Println("File written successfully to outputs/test.txt")
}
