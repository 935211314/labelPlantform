# LabelPlantform

A comprehensive image annotation platform built with Django, designed for managing labeling tasks, quality control, and collaboration between annotators, reviewers, and clients.

## 🌟 Features

- **Multi-role System**: Platform admins, organization admins, annotators, reviewers, and clients
- **Flexible Annotation Formats**: Support for JSON (LabelMe), XML (Pascal VOC), and TXT (YOLO) formats
- **Quality Control**: Dedicated QC workflow to ensure annotation quality
- **Organization Management**: Multi-tenant system with organization-based access control
- **Client Review**: Client-side review and approval of annotations
- **Progress Tracking**: Real-time progress monitoring for all tasks
- **Responsive UI**: Modern, intuitive interface with soft color scheme

## 🚀 Quick Start

### Prerequisites
- Python 3.8+
- PostgreSQL (or SQLite for development)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/labelPlantform.git
cd labelPlantform
```

2. Create a virtual environment:
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

3. Install dependencies:
```bash
pip install -r requirements.txt
```

4. Configure database (update `settings.py` as needed):
```bash
python manage.py migrate
```

5. Create a superuser:
```bash
python manage.py createsuperuser
```

6. Start the development server:
```bash
python manage.py runserver
```

## 📋 Project Structure

```
labelPlantform/
├── label/                 # Core annotation functionality
│   ├── models.py          # Database models
│   ├── views.py           # Business logic
│   └── urls.py            # URL routing
├── user/                  # User management
│   ├── models.py          # User and organization models
│   ├── views.py           # Authentication and management
│   └── urls.py            # User-related routes
├── templates/             # HTML templates
├── static/                # Static assets (CSS, JS, images)
└── media/                 # Uploaded files
```

## 🔐 User Roles

- **Platform Admin**: Full system access, manages organizations
- **Organization Admin**: Manages organization members and tasks
- **Annotator**: Performs image annotation tasks
- **Reviewer**: Quality control and validation
- **Client**: Reviews and approves completed annotations

## 📊 Workflow

1. Platform admin uploads task packages
2. Organization admin assigns tasks to annotators
3. Annotators complete image annotations
4. Reviewers validate annotations for quality
5. Clients review and approve final results

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for more details.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built with Django framework
- Inspired by various annotation tools in the ML community
- Thanks to all contributors who help improve this platform

---

⭐ If you find this project useful, please give it a star! Your support motivates further development.