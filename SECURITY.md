# Security Policy

The SDK builds transactions from quotes the Chain Payments service signs; the Move package verifies the signature, so a
tampered quote cannot pay a different amount or recipient. The SDK validates every field before building, sends no
credentials, and caches nothing. Report vulnerabilities through GitHub's private vulnerability reporting.
