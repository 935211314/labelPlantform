# Contributing to LabelPlantform

Thank you for your interest in contributing to LabelPlantform! We appreciate your help in improving this image annotation platform.

## 🛠 How to Contribute

### Reporting Issues
- Check existing issues before creating a new one
- Provide detailed information about the problem
- Include steps to reproduce the issue
- Suggest possible solutions if you have them

### Feature Requests
- Explain the problem you're trying to solve
- Describe your proposed solution
- Consider the impact on existing functionality

### Pull Requests
1. Fork the repository
2. Create a new branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Add tests if applicable
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

## 🧪 Development Setup

1. Clone your fork:
```bash
git clone https://github.com/YOUR_USERNAME/labelPlantform.git
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

4. Run migrations:
```bash
python manage.py migrate
```

5. Run the development server:
```bash
python manage.py runserver
```

## 📋 Code Guidelines

- Follow PEP 8 style guidelines
- Write meaningful commit messages
- Add docstrings to functions and classes
- Keep pull requests focused on a single feature or bug fix
- Update documentation when needed

## 🧪 Testing

Before submitting a pull request, please ensure all tests pass:
```bash
python manage.py test
```

If you're adding new functionality, please include appropriate tests.

## 🤝 Community

- Be respectful and inclusive
- Provide constructive feedback
- Help others in the community
- Share your experiences and learnings

## Questions?

Feel free to reach out by opening an issue if you have questions about contributing.

Thank you for helping make LabelPlantform better!