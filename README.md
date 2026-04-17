# LabelPlantform - Professional Image Annotation Platform

<div align="center">

[English](README_EN.md) | [简体中文](README_CN.md)

</div>

![Platform Demo](docs/screenshot.png) <!-- Placeholder for actual screenshot -->

A comprehensive image annotation platform built with Django, designed for managing labeling tasks, quality control, and collaboration between annotators, reviewers, and clients.

**🚀 One-Click Deploy | 📊 Real-time Progress Tracking | 🔐 Multi-role Access Control**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Django](https://img.shields.io/badge/Django-%23092E20.svg?logo=django&logoColor=white)](https://www.djangoproject.com/)
[![Python](https://img.shields.io/badge/Python-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/yourusername/labelPlantform/pulls)

</div>

## 🌟 Key Features

### 👥 Multi-role Collaboration System
- **Platform Admin**: Full system access, manages organizations and client accounts
- **Organization Admin**: Manages organization members and assigns tasks
- **Annotator**: Performs image annotation tasks
- **Reviewer**: Quality control and validation
- **Client**: Reviews and approves completed annotations

### 📋 Complete Annotation Workflow
- **Task Management**: Upload, distribute, and track annotation tasks
- **Quality Assurance**: Three-tier quality control (annotator → reviewer → client)
- **Progress Monitoring**: Real-time tracking of task completion rates
- **Format Support**: JSON (LabelMe), XML (Pascal VOC), TXT (YOLO)

### 🔐 Advanced Access Control
- **Organization-based Isolation**: Multi-tenant architecture ensuring data separation
- **Role-based Permissions**: Granular access control for different user types
- **Approval Workflows**: Structured process for joining organizations and task assignment

### 🎨 User Experience
- **Modern UI**: Soft color scheme and responsive design
- **Intuitive Annotation Tools**: Visual annotation interface with multiple shape support
- **Real-time Feedback**: Live progress updates and status indicators

## 🚀 Quick Start

### Prerequisites
- Python 3.8+
- PostgreSQL (or SQLite for development)

### Easy Deployment
```bash
# Clone the repository
git clone https://github.com/yourusername/labelPlantform.git
cd labelPlantform

# Use the startup script (supports both Linux and Windows)
# On Linux/Mac:
chmod +x start.sh
./start.sh

# On Windows:
start.bat
```

### Manual Installation
1. Create a virtual environment:
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Configure database (update `settings.py` as needed):
```bash
python manage.py migrate
```

4. Create a superuser:
```bash
python manage.py createsuperuser
```

5. Load demo data (optional, to explore features):
```bash
python demo_data.py
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
│   ├── views.py           # Business Logic
│   └── urls.py            # URL routing
├── user/                  # User management
│   ├── models.py          # User and organization models
│   ├── views.py           # Authentication and management
│   └── urls.py            # User-related routes
├── templates/             # HTML templates
├── static/                # Static assets (CSS, JS, images)
└── media/                 # Uploaded files
```

## � Complete Workflow

1. **Task Creation**: Platform admin uploads task packages with images
2. **Task Assignment**: Organization admin assigns tasks to annotators
3. **Annotation Phase**: Annotators complete image labeling
4. **Quality Control**: Reviewers validate annotations for accuracy
5. **Client Approval**: Clients review and approve final results

## 🤝 Contributing

We love contributions! Here's how you can help:

- 🐛 **Bug Reports**: Open issues for bugs you find
- 💡 **Feature Requests**: Suggest new features or improvements
- 🔧 **Pull Requests**: Submit code improvements
- 📝 **Documentation**: Improve docs and examples
- ⭐ **Stars**: Give us a star to show your support!

Please read our [Contributing Guide](CONTRIBUTING.md) for more details.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 📞 Support & Contact

- Email: [whz010203@gmail.com](mailto:whz010203@gmail.com)
- 🐛 **Issues**: [GitHub Issues](https://github.com/yourusername/labelPlantform/issues)
- 📖 **Documentation**: [Docs](docs/)

## 🙏 Acknowledgments

- Built with the powerful [Django framework](https://www.djangoproject.com/)
- Inspired by various annotation tools in the ML community
- Thanks to all contributors who help improve this platform

---

<div align="center">

### 🌟 Show Your Support!

⭐ If you find this project useful, please give it a star! Your support motivates further development.

[![Star this project](https://img.shields.io/github/stars/yourusername/labelPlantform?style=social)](https://github.com/yourusername/labelPlantform)

</div>