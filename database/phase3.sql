-- Phase 3 tables (fees + payments). The server runs this file at startup (safe to run repeatedly).
CREATE TABLE IF NOT EXISTS fees (code VARCHAR(16) PRIMARY KEY, label VARCHAR(60) NOT NULL, amount DECIMAL(8,2) NOT NULL, per_unit TINYINT(1) NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS payments (
  id INT AUTO_INCREMENT PRIMARY KEY, student_id INT NOT NULL, term VARCHAR(10) NOT NULL, amount DECIMAL(10,2) NOT NULL,
  method ENUM('gcash','maya','cashier') NOT NULL, status ENUM('pending','paid') NOT NULL DEFAULT 'pending',
  reference VARCHAR(20) NOT NULL UNIQUE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, confirmed_by INT, confirmed_at TIMESTAMP NULL,
  UNIQUE (student_id, term), FOREIGN KEY (student_id) REFERENCES students(user_id), FOREIGN KEY (confirmed_by) REFERENCES users(id));
INSERT IGNORE INTO fees VALUES ('tuition','Tuition per unit',250,1),('reg','Registration',200,0),('lib','Library',150,0),('med','Medical and dental',100,0),('id','Student ID',100,0);
