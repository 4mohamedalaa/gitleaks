// Simple application
const express = require('express');
const app = express();
const port = 3000;

// Configuration using environment variables (GOOD PRACTICE)
const config = {
  appName: 'Demo App',
  port: process.env.PORT || 3000,
  environment: process.env.NODE_ENV || 'development',
  aws_access_key: process.env.AWS_ACCESS_KEY,
  aws_secret_key: process.env.AWS_SECRET_KEY,
  db_connection: process.env.DB_CONNECTION
};

app.get('/', (req, res) => {
  res.send('Hello World!');
});

app.listen(port, () => {
  console.log(`App listening at http://localhost:${port}`);
});