create table orders (
  id serial primary key,
  user_id int not null,
  total numeric(10,2)
);
