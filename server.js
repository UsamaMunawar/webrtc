const app = require('express')();
const server = require('http').createServer(app);
const axios = require('axios');
const cors = require('cors');

const io = require('socket.io')(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

app.use(function (req, res, next) {
  res.header('Access-Control-Allow-Origin', 'YOUR-DOMAIN.TLD');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );
  next();
});

const PORT = process.env.PORT || 5000;

app.get('/', (req, res) => {
  res.send('Running');
});

io.on('connection', (socket) => {
  socket.emit('me', socket.id);
  console.log({ socket: socket.id });
  socket.on('registerToSession', ({ sessionId }) => {
    console.log({ sessionId });
    socket.join(sessionId);
  });

  socket.on('disconnect', () => {
    // socket.broadcast.emit('callEnded');
  });

  socket.on('callUser', ({ userToCall, signalData, from }) => {
    io.to(userToCall).emit('callUser', { signal: signalData, from });
    // socket.broadcast.emit('callUser', { signal: signalData });
  });

  socket.on('answerCall', (data) => {
    // socket.to('testing-socket').emit('callAccepted', data.signal);
    // socket.broadcast.emit('callAccepted', data.signal);
    io.to(data.to).emit('callAccepted', data.signal);
  });

  socket.on('call_ended', (data) => {
    console.log('call_ended',data)
    io.to(data.id).emit('callEnded');
  });

  socket.on('update_todays_orders_count', async (data) => {
    const response = await axios.post(`${data.url}/api/user/authenticate`, {
      jsonrpc: '2.0',
      params: {
        db: data.database,
        email: data.email,
        password: data.password,
        api_type: 'today_orders',
        req_arg: {
          session_id: data.sessionId,
          pos_type: data.posType,
        },
      },
    });
    io.in(data.sessionId).emit('get_updated_orders_count', {
      result: JSON.stringify(response?.data?.result),
    });
  });

  socket.on('update_kds_screen', async (data) => {
    try {
      const response = await axios.post(`${data.url}/api/user/authenticate`, {
        jsonrpc: '2.0',
        params: {
          db: data.database,
          email: data.email,
          password: data.password,
          api_type: 'kds_fetch_info',
          req_arg: {
            session_id: data.sessionId,
            bump_screen_mode: data.bump_screen_mode,
          },
        },
      });
      io.in(data.sessionId).emit('updated_kds_data', {
        response: JSON.stringify(response?.data),
      });
    } catch (error) {
      console.log(error);
    }
  });

  socket.on('update_saved_orders_count', async (data) => {
    console.log('update_saved_orders_count', data);
    const body = {
      jsonrpc: '2.0',
      params: {
        db: data.database,
        email: data.email,
        password: data.password,
        api_type: 'fetch_saved_orders',
        req_arg: {
          session_id: data.sessionId,
          pos_type: data.posType || data.PosType,
          floor_id: data.floor_id ? data.floor_id : false,
          table_id: data.table_id ? data.table_id : false,
        },
      },
    };
    console.log(body);
    const response = await axios.post(
      `${data.url}/api/user/authenticate`,
      body
    );
    console.log('saved_orders_count', response?.data);
    io.in(data.sessionId).emit('updated_saved_orders_count', {
      result: JSON.stringify(response?.data?.result),
    });
  });

  socket.on('update_customer_points', async (data) => {
    try {
      const response = await axios.post(`${data.url}/api/user/authenticate`, {
        jsonrpc: '2.0',
        params: {
          db: data.database,
          email: data.email,
          password: data.password,
          api_type: 'customers_points',
        },
      });
      io.in(data.sessionId).emit('updated_kds_data', {
        response: JSON.stringify(response?.data),
      });
    } catch (error) {
      console.log(error);
    }
  });

  socket.on('update-live-screen', (data) => {
    if (data?.order === 'saved') {
      io.in(data?.sessionId).emit('updated-live-screen', {
        order: 'saved',
      });
      return;
    }
    if (data?.order === 'discarded') {
      io.in(data?.sessionId).emit('updated-live-screen', {
        order: 'discarded',
      });
      return;
    }
    if (data?.order === 'paid') {
      io.in(data?.sessionId).emit('updated-live-screen', {
        order: 'paid',
      });
      return;
    }
    const order = JSON.parse(data?.order);
    const customer = data?.customer;
    const selectedPos = data?.selectedPos;
    io.in(data?.sessionId).emit('updated-live-screen', {
      order: order,
      customer: customer,
      selectedPos: selectedPos,
    });
  });
});

server.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
