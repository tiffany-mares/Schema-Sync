create table users (
  id serial primary key
);

create table orders (
  id serial primary key,
  user_id int not null,
  foreign key (user_id) references users(id)
);
