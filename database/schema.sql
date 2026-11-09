-- PTC Fast-Enroll: 3NF schema + SAMPLE data. Import in phpMyAdmin (Import tab).
CREATE DATABASE IF NOT EXISTS ptc_fast_enroll CHARACTER SET utf8mb4;
USE ptc_fast_enroll;

CREATE TABLE programs (id INT AUTO_INCREMENT PRIMARY KEY, code VARCHAR(12) NOT NULL UNIQUE, name VARCHAR(100) NOT NULL);
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY, full_name VARCHAR(100) NOT NULL, email VARCHAR(120) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  role ENUM('student','registrar','cashier','program_head','super_admin') NOT NULL DEFAULT 'student',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE students (
  user_id INT PRIMARY KEY, program_id INT NOT NULL,
  student_type ENUM('new','continuing','transferee','returnee','irregular') NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id), FOREIGN KEY (program_id) REFERENCES programs(id));
CREATE TABLE courses (id INT PRIMARY KEY, code VARCHAR(12) NOT NULL UNIQUE, title VARCHAR(100) NOT NULL, units TINYINT NOT NULL);
CREATE TABLE course_prereqs (
  course_id INT, prereq_id INT, PRIMARY KEY (course_id, prereq_id),
  FOREIGN KEY (course_id) REFERENCES courses(id), FOREIGN KEY (prereq_id) REFERENCES courses(id));
CREATE TABLE completed_courses (
  student_id INT, course_id INT, PRIMARY KEY (student_id, course_id),
  FOREIGN KEY (student_id) REFERENCES students(user_id), FOREIGN KEY (course_id) REFERENCES courses(id));
CREATE TABLE sections (
  id INT PRIMARY KEY, course_id INT NOT NULL, code VARCHAR(8) NOT NULL, capacity SMALLINT NOT NULL, term VARCHAR(10) NOT NULL,
  FOREIGN KEY (course_id) REFERENCES courses(id));
CREATE TABLE meetings (
  id INT AUTO_INCREMENT PRIMARY KEY, section_id INT NOT NULL, day TINYINT NOT NULL, -- 1=Mon ... 6=Sat
  start_time TIME NOT NULL, end_time TIME NOT NULL, room VARCHAR(20), FOREIGN KEY (section_id) REFERENCES sections(id));
CREATE TABLE applications (
  id INT AUTO_INCREMENT PRIMARY KEY, student_id INT NOT NULL, term VARCHAR(10) NOT NULL,
  stage TINYINT NOT NULL DEFAULT 1, UNIQUE (student_id, term), FOREIGN KEY (student_id) REFERENCES students(user_id));
CREATE TABLE enrollments (
  application_id INT, section_id INT, PRIMARY KEY (application_id, section_id),
  FOREIGN KEY (application_id) REFERENCES applications(id), FOREIGN KEY (section_id) REFERENCES sections(id));

INSERT INTO programs (code, name) VALUES ('BSIT','BS Information Technology'),('BSBA','BS Business Administration'),('BSED','BS Education');
INSERT INTO courses VALUES (1,'IT101','Introduction to Computing',3),(2,'IT102','Computer Programming 1',3),(3,'IT103','Web Systems',3),
 (4,'MATH101','College Algebra',3),(5,'ENG101','Purposive Communication',3),(6,'PE101','Physical Fitness',2),
 (7,'NSTP1','National Service Training 1',3),(8,'HIST101','Readings in Philippine History',3);
INSERT INTO course_prereqs VALUES (2,1),(3,1);
INSERT INTO sections VALUES (1,1,'A',40,'2026-1'),(2,1,'B',2,'2026-1'),(3,2,'A',35,'2026-1'),(4,3,'A',35,'2026-1'),(5,4,'A',40,'2026-1'),
 (6,4,'B',40,'2026-1'),(7,5,'A',40,'2026-1'),(8,6,'A',45,'2026-1'),(9,7,'A',45,'2026-1'),(10,8,'A',40,'2026-1'),(11,8,'B',40,'2026-1');
INSERT INTO meetings (section_id, day, start_time, end_time, room) VALUES
 (1,1,'08:00','09:30','CL1'),(1,3,'08:00','09:30','CL1'),(2,2,'13:00','14:30','CL1'),(2,4,'13:00','14:30','CL1'),
 (3,2,'08:00','09:30','CL2'),(3,4,'08:00','09:30','CL2'),(4,5,'08:00','11:00','CL2'),
 (5,1,'08:30','10:00','R201'),(5,3,'08:30','10:00','R201'),(6,1,'10:00','11:30','R201'),(6,3,'10:00','11:30','R201'),
 (7,2,'10:00','11:30','R202'),(7,4,'10:00','11:30','R202'),(8,6,'08:00','10:00','Gym'),(9,6,'10:00','13:00','R203'),
 (10,1,'13:00','14:30','R204'),(10,3,'13:00','14:30','R204'),(11,2,'14:30','16:00','R204'),(11,4,'14:30','16:00','R204');
