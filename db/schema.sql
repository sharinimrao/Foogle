-- Fed Up: user persistence schema (Postgres / Neon)
-- Run via scripts/migrate.mjs. Idempotent — safe to run more than once.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  auth_provider TEXT NOT NULL DEFAULT 'local', -- 'local' | 'google'
  google_id TEXT UNIQUE,
  password_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dietary_preferences (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  preference TEXT NOT NULL,
  PRIMARY KEY (user_id, preference)
);

CREATE TABLE IF NOT EXISTS been_there (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  restaurant_name TEXT NOT NULL,
  cuisine TEXT,
  price TEXT,
  city TEXT,
  marked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, restaurant_name)
);

CREATE TABLE IF NOT EXISTS wish_list (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  restaurant_name TEXT NOT NULL,
  cuisine TEXT,
  price TEXT,
  city TEXT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, restaurant_name)
);

CREATE TABLE IF NOT EXISTS friendships (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'accepted', -- 'pending' | 'accepted' | 'blocked'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, friend_id)
);

CREATE INDEX IF NOT EXISTS been_there_user_idx ON been_there(user_id);
CREATE INDEX IF NOT EXISTS wish_list_user_idx ON wish_list(user_id);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS friendships_friend_idx ON friendships(friend_id);
