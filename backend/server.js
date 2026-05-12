require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'X-Admin-Key']
}));

app.use(express.json());

app.use('/api', require('./routes/election'));
app.use('/api/admin', require('./routes/admin'));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
