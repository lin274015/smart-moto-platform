# Smart Moto Platform

AI-powered motorcycle maintenance management platform built with Node.js and Gemini AI.

---

## Introduction

Smart Moto Platform is a full-stack motorcycle maintenance management system developed as a software engineering project.

The platform combines repair record management with AI-powered services such as:

- AI maintenance advice
- AI repair report generation
- AI diagnosis
- AI customer assistant
- Intelligent quotation calculation

The long-term goal is to become a deployable motorcycle maintenance platform instead of a classroom prototype.

---

## Features

### Repair Record Management

- Search repair records
- Store maintenance history
- JSON database (temporary)

### AI Assistant

- Gemini AI integration
- RAG-based maintenance knowledge
- AI customer service

### AI Maintenance

- Maintenance recommendation
- Repair report generation
- Fault diagnosis

### Quotation System

- Automatic quotation calculation
- Gross profit calculation
- Material cost analysis

---

## Tech Stack

Backend

- Node.js
- JavaScript (ES Modules)

AI

- Gemini API
- RAG

Database

- JSON (Current)
- PostgreSQL (Planned)

Tools

- Git
- GitHub

Deployment (Planned)

- Docker
- Ubuntu Linux

---

## Project Structure

smart-moto-platform

├── backend/
│ ├── data/
│ ├── public/
│ ├── services/
│ ├── tools/
│ ├── package.json
│ └── server.js
│
├── docs/
│
├── frontend/
│
└── README.md

---

## Installation

Clone repository

```bash
git clone https://github.com/lin274015/smart-moto-platform.git

Install packages

cd backend
npm install

Run server

npm start

Open browser

http://localhost:4173

Current Architecture

Browser
↓
Node.js Backend
↓
Gemini AI
↓
JSON Database

Current Architecture

Browser

↓

Node.js Backend

↓

Gemini AI

↓

JSON Database

Roadmap
v0.1
GitHub Repository
Initial Version
v0.2
Project Structure
Documentation
v0.3
Service Layer Refactoring
v0.4
Utility Layer Refactoring
v0.5
PostgreSQL
v0.6
JWT Authentication
v0.7
Docker
v0.8
Linux Deployment
v1.0

Production Ready

Docker
PostgreSQL
JWT
React
CI/CD

Future Improvements
PostgreSQL
Docker Compose
JWT Authentication
React Frontend
Swagger API
GitHub Actions
CI/CD
Linux Deployment