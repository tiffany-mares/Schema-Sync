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


PAYMENTS_DDL = """
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
  created_at timestamptz default now()
);

create table transactions (
  id serial primary key,
  user_id int not null references users(id),
  amount numeric(12,2) not null,
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


def full_demo():
    """Seed main plus the feature/add-payments branch of the demo script:
    adds transactions, drops orders.total."""
    main()
    httpx.post(
        f"{BASE}/repos/demo/branches",
        json={"name": "feature/add-payments", "from": "main"},
        timeout=30,
    ).raise_for_status()
    r = httpx.post(
        f"{BASE}/repos/demo/commits",
        json={
            "branch": "feature/add-payments",
            "ddl": PAYMENTS_DDL,
            "message": "add transactions, drop orders.total",
        },
        timeout=30,
    )
    r.raise_for_status()
    print(f"feature/add-payments: {[c['kind'] for c in r.json()['changes']]}")


if __name__ == "__main__":
    import sys

    if "--full" in sys.argv:
        full_demo()
    else:
        main()
