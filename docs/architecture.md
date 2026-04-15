# Project Architecture

## Overview
LabelPlantform is a Django-based image annotation platform that enables collaborative image labeling with quality control workflows.

## Directory Structure
```
labelPlantform/
├── label/                 # Core annotation module
│   ├── migrations/        # Database migration files
│   ├── models.py          # Task, ImageFile, Assignment models
│   ├── views.py           # Annotation interfaces and APIs
│   ├── urls.py            # Annotation-specific routes
│   └── forms.py           # Upload and management forms
├── user/                  # User management module
│   ├── models.py          # User, Organization, Role models
│   ├── views.py           # Authentication and management views
│   ├── urls.py            # User-related routes
│   └── forms.py           # Registration and profile forms
├── labelPlantform/        # Django project settings
│   ├── settings.py        # Configuration
│   ├── urls.py            # Main URL routing
│   └── wsgi.py            # WSGI application
├── templates/             # HTML templates organized by app
│   └── label/             # Annotation templates
│   └── user/              # User management templates
├── static/                # Static assets
│   ├── label/             # Annotation interface assets
│   ├── labelweb/          # Web-based annotation tool
│   └── user/              # User interface assets
├── media/                 # Uploaded content (images, annotations)
├── db.sqlite3             # Default database (in production, use PostgreSQL)
├── manage.py              # Django management script
├── README.md              # Project overview
├── CONTRIBUTING.md        # Contribution guidelines
├── LICENSE                # License information
└── requirements.txt       # Python dependencies
```

## Key Components

### 1. User Management System
- Multi-level permissions (platform admin, org admin, annotator, reviewer, client)
- Organization-based access control
- Role-based authorization
- Join request approval workflow

### 2. Annotation Workflow
- Task package upload and distribution
- Image annotation with multiple format support (JSON, XML, TXT)
- Quality control verification
- Client review and approval

### 3. Data Models
- `TaskPackage`: Represents a collection of images to annotate
- `ImageFile`: Individual images within a task package
- `TaskAssignment`: Links users to task packages they're working on
- `QcAssignment`: Quality control assignments
- `User`: Extended Django user with roles and organization
- `Organization`: Grouping mechanism for users and tasks

### 4. Frontend Interface
- Responsive design with soft color scheme
- Intuitive annotation tools
- Progress tracking dashboards
- Mobile-friendly layouts

## Security Features
- django-axes for brute force protection
- Proper authentication and authorization
- Input validation and sanitization
- Secure file upload handling

## Deployment Notes
- Production-ready with PostgreSQL support
- Static file serving configuration
- Media file management
- Environment-based configuration