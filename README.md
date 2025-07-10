# Academic Calculator Flask App

A Flask-based academic calculator with Firebase integration for CGPA calculation, attendance tracking, and timetable management.

## Setup Instructions

### 1. Clone the Repository
\`\`\`bash
git clone <your-repo-url>
cd academic-calculator
\`\`\`

### 2. Create Virtual Environment
\`\`\`bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
\`\`\`

### 3. Install Dependencies
\`\`\`bash
pip install -r requirements.txt
\`\`\`

### 4. Environment Configuration

#### Option A: Using Environment Variables (Recommended for Production)
1. Copy `.env.example` to `.env`:
   \`\`\`bash
   cp .env.example .env
   \`\`\`

2. Edit `.env` file with your actual values:
   - Set your Firebase project credentials
   - Generate a strong SECRET_KEY
   - Configure other settings as needed

#### Option B: Using Service Account File (Development)
1. Download your Firebase service account key as `firebase_key.json`
2. Place it in the project root directory
3. The app will automatically detect and use this file

### 5. Firebase Setup
1. Create a Firebase project at https://console.firebase.google.com
2. Enable Firestore Database
3. Create a service account and download the key
4. Either use the key file or extract the values for environment variables

### 6. Run the Application
\`\`\`bash
python app.py
\`\`\`

The application will be available at `http://localhost:5000`

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `SECRET_KEY` | Flask secret key for sessions | Yes |
| `FLASK_ENV` | Environment (development/production) | No |
| `FLASK_DEBUG` | Enable debug mode (True/False) | No |
| `FIREBASE_PROJECT_ID` | Firebase project ID | Yes* |
| `FIREBASE_PRIVATE_KEY` | Firebase private key | Yes* |
| `FIREBASE_CLIENT_EMAIL` | Firebase client email | Yes* |
| `SESSION_TIMEOUT_MINUTES` | Session timeout in minutes | No |

*Required if not using service account file

## Security Notes

- Never commit `.env` files to version control
- Use strong, unique SECRET_KEY in production
- Enable HTTPS in production (SESSION_COOKIE_SECURE=True)
- Regularly rotate Firebase service account keys

## Features

- User registration and authentication
- CGPA calculation with multiple semesters
- Attendance tracking and recommendations
- Timetable management
- Kerala holidays calendar
- Calculation history
- Firebase cloud storage

## API Endpoints

- `POST /register` - User registration
- `POST /login` - User login
- `GET /logout` - User logout
- `GET /api/timetable` - Get user timetable
- `POST /api/timetable` - Save user timetable
- `POST /api/calculate_cgpa` - Calculate CGPA
- `POST /api/calculate_attendance` - Calculate attendance
- `GET /api/holidays` - Get holidays list
- `GET /api/history` - Get calculation history

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is licensed under the MIT License.
