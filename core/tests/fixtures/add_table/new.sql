create table users (
  id serial primary key,
  email text not null
);

create table transactions (
  id serial primary key,
  user_id int not null references users(id),
  amount numeric(12,2) not null,
  created_at timestamptz default now()
);
