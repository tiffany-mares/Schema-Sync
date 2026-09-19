"""Seed the demo repo: users/products/orders on main.

Run with the vcs server up:  python -m vcs.seed
"""

import httpx

BASE = "http://localhost:8000"

BASE_DDL = """
create table users (
  id serial primary key,
  email text not null,
  name text
);

create table products (
  id serial primary key,
  name text not null,
  price numeric(10,2) not null
);

create table orders (
  id serial primary key,
  user_id int not null references users(id),
  product_id int not null references products(id),
  total numeric(10,2),
  created_at timestamptz default now()
);
"""


def main():
    r = httpx.post(
        f"{BASE}/repos/demo/commits",
        json={"branch": "main", "ddl": BASE_DDL, "message": "initial schema"},
        timeout=30,
    )
    r.raise_for_status()
    body = r.json()
    print(f"seeded demo/main at {body['hash'][:12]} with {len(body['changes'])} changes")


if __name__ == "__main__":
    main()
