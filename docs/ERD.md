# PTC Fast-Enroll: Entity Relationship Diagram

Paste the diagram below into https://mermaid.live to export it as PNG or SVG for your slides.
(WebStorm's Markdown preview also draws Mermaid diagrams.)

```mermaid
erDiagram
  programs ||--o{ students : "has"
  users ||--o| students : "is a"
  students ||--o{ completed_courses : "finished"
  courses ||--o{ completed_courses : "completed in"
  courses ||--o{ course_prereqs : "needs"
  courses ||--o{ course_prereqs : "is needed by"
  courses ||--o{ sections : "offered as"
  sections ||--|{ meetings : "meets"
  students ||--o{ applications : "applies"
  applications ||--o{ enrollments : "reserves"
  sections ||--o{ enrollments : "holds"
  students ||--o{ documents : "uploads"
  document_types ||--o{ documents : "classifies"
  users ||--o{ documents : "reviews"
  users ||--o{ audit_log : "performs"
  students ||--o{ payments : "pays"
  users ||--o{ payments : "confirms"

  programs { int id PK
    varchar code UK
    varchar name }
  users { int id PK
    varchar full_name
    varchar email UK
    varchar password_hash
    enum role "student, registrar, cashier, program_head, super_admin" }
  students { int user_id PK, FK
    int program_id FK
    enum student_type "new, continuing, transferee, returnee, irregular" }
  courses { int id PK
    varchar code UK
    varchar title
    tinyint units }
  course_prereqs { int course_id PK, FK
    int prereq_id PK, FK }
  completed_courses { int student_id PK, FK
    int course_id PK, FK }
  sections { int id PK
    int course_id FK
    varchar code
    smallint capacity
    varchar term }
  meetings { int id PK
    int section_id FK
    tinyint day
    time start_time
    time end_time
    varchar room }
  applications { int id PK
    int student_id FK
    varchar term
    tinyint stage "UK with student_id and term" }
  enrollments { int application_id PK, FK
    int section_id PK, FK }
  document_types { varchar code PK
    varchar label }
  documents { int id PK
    int student_id FK
    varchar type_code FK
    varchar stored_name
    enum status "pending, approved, rejected"
    varchar remarks
    int reviewed_by FK }
  audit_log { int id PK
    int user_id FK
    varchar action
    int document_id
    varchar detail
    timestamp created_at }
  fees { varchar code PK
    varchar label
    decimal amount
    tinyint per_unit }
  payments { int id PK
    int student_id FK
    varchar term
    decimal amount
    enum method "gcash, maya, cashier"
    enum status "pending, paid"
    varchar reference UK
    int confirmed_by FK }
```

## Why it is in 3NF
- Every non-key column depends on the key, the whole key, and nothing but the key.
- Repeating groups live in their own tables: a section's meeting times are rows in `meetings`, a student's reserved sections are rows in `enrollments`, prerequisites are rows in `course_prereqs`.
- Names and titles are stored once (`programs`, `courses`, `document_types`) and referenced by id.
- Uploaded files are not in the database. Only the stored file name is (`documents.stored_name`).
- The enrollment stage shown to students is computed from documents, enrollments and payments, so it can never disagree with them.
