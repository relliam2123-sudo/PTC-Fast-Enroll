# PTC Fast-Enroll: REST API

Base URL: `http://localhost:3000`. JSON in and out. Protected routes need the header `Authorization: Bearer <token>` (the token comes from login or register and lasts 8 hours).
Errors look like `{ "error": "message" }`. "Staff" roles: Registrar (R), Cashier (C), Program Head (H), Super Admin (A, can do everything).

## Public
| Method and path | Purpose |
|---|---|
| `GET /api/programs` | List programs |
| `POST /api/register` | Body `name, email, password (8+), program_id, student_type`. Returns `token` |
| `POST /api/login` | Body `email, password`. Returns `token` |
| `GET /verify/:reference` | Page the certificate QR code opens. 200 if the payment is real, 404 if not |

## Student
| Method and path | Purpose |
|---|---|
| `GET /api/me` | Profile, enrollment `stage` (1 to 6), reserved section ids. Staff get `{ staff: true, role }` |
| `GET /api/sections` | Sections with times, seats taken, and whether a prerequisite is missing (catalog cached 60 s) |
| `POST /api/enroll` | Body `section_ids[]`. Checks documents approved, prerequisites, schedule conflicts, unit limit and seats (seat check is transactional) |
| `GET /api/documents` | The 4 required documents with status and remarks |
| `PUT /api/documents/:code` | Raw file body (PDF, JPG or PNG, 5 MB max). Headers `Content-Type` and `X-Filename`. Streamed to disk |
| `GET /api/payment` | Fee breakdown and the current payment, if any |
| `POST /api/payment` | Body `method` (`gcash`, `maya`, `cashier`) and `mobile` for gcash/maya. GCash and Maya are simulated |
| `GET /api/cor` | Certificate of Registration PDF, only when officially enrolled |

## Registrar (R)
| Method and path | Purpose |
|---|---|
| `GET /api/staff/overview` | Student count, document counts, seats per section, recent activity |
| `GET /api/staff/documents` | Pending documents |
| `GET /api/staff/documents/:id/file` | The uploaded file |
| `POST /api/staff/review` | Body `ids[], decision` (`approved` or `rejected`), `remarks` (required to reject). Batch capable, audit logged |

## Sections (R, H)
| Method and path | Purpose |
|---|---|
| `GET /api/staff/sections` | Sections, seats taken, counts per student type, schedule |
| `POST /api/staff/sections` | Body `course_id, capacity, days[], start, end, room`. Creates the next section letter |
| `PATCH /api/staff/sections/:id` | Body `capacity` (cannot go below students already enrolled) |
| `GET /api/staff/sections/:id/students` | Who is in a section |

## Cashier (C)
| Method and path | Purpose |
|---|---|
| `GET /api/staff/payments` | Totals, pending cashier payments, recent payments |
| `POST /api/staff/payments/:id/confirm` | Mark a cashier payment as paid |

## Admin tools (H)
| Method and path | Purpose |
|---|---|
| `GET /api/staff/users?q=` | Search student accounts |
| `POST /api/staff/users/:id/reset` | Clear one student's documents, sections and payment |
| `DELETE /api/staff/users/:id` | Delete a student account and their uploads |
| `POST /api/staff/reset` | Body `scope` (`enrollments` or `all`) and `confirm: "RESET"` |

## Enrollment stages
1 Account created, 2 Documents submitted, 3 Registrar evaluating, 4 Sections reserved (documents approved, choose sections), 5 Payment pending, 6 Officially enrolled.
