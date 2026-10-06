-- MySQL 8 schema: relational, transactional data (users, bookings, payments).
-- Artist profiles and reviews live in MongoDB (see src/models).
-- Idempotent: safe to run repeatedly via `npm run db:migrate`.

CREATE TABLE IF NOT EXISTS users (
  id             INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  name           VARCHAR(120)     NOT NULL,
  email          VARCHAR(255)     NOT NULL,
  password_hash  CHAR(60)         NOT NULL,              -- bcrypt output is always 60 chars
  role           ENUM('artist','client') NOT NULL,
  created_at     DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS bookings (
  id             INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  artist_id      INT UNSIGNED     NOT NULL,
  client_id      INT UNSIGNED     NOT NULL,
  status         ENUM('pending','confirmed','in_progress','completed','cancelled') NOT NULL DEFAULT 'pending',
  event_start    DATETIME         NOT NULL,              -- stored in UTC
  event_end      DATETIME         NOT NULL,              -- stored in UTC
  notes          TEXT             NOT NULL,
  cancelled_by   ENUM('artist','client') NULL,
  created_at     DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_bookings_artist FOREIGN KEY (artist_id) REFERENCES users (id),
  CONSTRAINT fk_bookings_client FOREIGN KEY (client_id) REFERENCES users (id),
  CONSTRAINT chk_bookings_window CHECK (event_end > event_start),
  -- Serves the overlap check: artist_id = ? AND status = 'confirmed' AND event_start < ?
  KEY idx_bookings_artist_status_start (artist_id, status, event_start),
  KEY idx_bookings_client (client_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Audit trail of every state-machine transition (who moved it, from what, to what, when).
CREATE TABLE IF NOT EXISTS booking_status_history (
  id             BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  booking_id     INT UNSIGNED     NOT NULL,
  from_status    ENUM('pending','confirmed','in_progress','completed','cancelled') NULL,
  to_status      ENUM('pending','confirmed','in_progress','completed','cancelled') NOT NULL,
  changed_by     INT UNSIGNED     NOT NULL,
  created_at     DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_bsh_booking FOREIGN KEY (booking_id) REFERENCES bookings (id) ON DELETE CASCADE,
  CONSTRAINT fk_bsh_user    FOREIGN KEY (changed_by) REFERENCES users (id),
  KEY idx_bsh_booking (booking_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS payments (
  id             INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  booking_id     INT UNSIGNED     NOT NULL,
  amount         DECIMAL(10,2)    NOT NULL,              -- never FLOAT for money
  currency       CHAR(3)          NOT NULL DEFAULT 'INR',
  status         ENUM('pending','succeeded','failed','refunded') NOT NULL DEFAULT 'pending',
  provider_ref   VARCHAR(100)     NULL,
  created_at     DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_payments_booking FOREIGN KEY (booking_id) REFERENCES bookings (id),
  CONSTRAINT chk_payments_amount CHECK (amount >= 0),
  UNIQUE KEY uq_payments_provider_ref (provider_ref),
  KEY idx_payments_booking (booking_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
