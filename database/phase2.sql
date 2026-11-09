-- Phase 2 tables. The server runs this file at startup (safe to run repeatedly).
CREATE TABLE IF NOT EXISTS document_types (code VARCHAR(16) PRIMARY KEY, label VARCHAR(60) NOT NULL);
CREATE TABLE IF NOT EXISTS documents (
  id INT AUTO_INCREMENT PRIMARY KEY, student_id INT NOT NULL, type_code VARCHAR(16) NOT NULL,
  original_name VARCHAR(150) NOT NULL, stored_name VARCHAR(80) NOT NULL,
  status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending', remarks VARCHAR(200),
  reviewed_by INT, uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, reviewed_at TIMESTAMP NULL,
  UNIQUE (student_id, type_code),
  FOREIGN KEY (student_id) REFERENCES students(user_id), FOREIGN KEY (type_code) REFERENCES document_types(code),
  FOREIGN KEY (reviewed_by) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS audit_log (
  id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, action VARCHAR(20) NOT NULL, document_id INT, detail VARCHAR(200),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id));
INSERT IGNORE INTO document_types VALUES ('form138','Form 138 (Report Card)'),('goodmoral','Certificate of Good Moral'),
  ('psa','PSA Birth Certificate'),('photo','2x2 ID Photo');
