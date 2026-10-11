-- Schema migration v11: persistent first-login orientation state.
CREATE TABLE IF NOT EXISTS user_onboarding (
    subject TEXT PRIMARY KEY,
    orientation_completed_at TIMESTAMP
);
