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
  res.header('Access-Control-Allow-Origin', '*');
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

const users = {};

io.on('connection', (socket) => {
  console.log('data', socket);
  socket.emit('connection-success', socket.id);
  socket.on('register-user', ({ user, sessionId }) => {
    if (users[sessionId]) {
      if (
        users[sessionId]?.activeUsers?.length &&
        users[sessionId]?.activeUsers?.find((u) => u?.socketId === socket.id)
      ) {
        users[sessionId].activeUsers = users[sessionId].activeUsers.map((u) =>
          u?.socketId === socket.id
            ? { ...user, socketId: socket.id }
            : { ...u, socketId: socket.id }
        );
        return;
      }
      users[sessionId] = {
        ...users[sessionId],
        activeUsers: [
          ...users[sessionId]?.activeUsers,
          { ...user, socketId: socket.id },
        ],
      };
    } else {
      users[sessionId] = {
        activeUsers: [{ ...user, socketId: socket.id }],
      };
    }
    socket.join(sessionId);
    console.log('loggingin', users[sessionId]?.activeUsers);
  });
  socket.on('customer-screen-opened', ({ sessionId, userR }) => {
    const isCustomerScreenOpened = users[sessionId]?.activeUsers?.find(
      (user) => user?.isCustomerScreen
    );
    if (isCustomerScreenOpened) {
      socket.emit('screen-exist');
      return;
    }
    if (users[sessionId]?.activeUsers?.length) {
      console.log('inside if');
      users[sessionId] = {
        ...users[sessionId],
        activeUsers: [
          ...users[sessionId]?.activeUsers?.map((user) => {
            console.log('inside map', user);
            return user?.socketId === socket.id
              ? { ...user, isCustomerScreen: true, isConnected: false }
              : { ...user };
          }),
        ],
      };
    } else {
      console.log('inside else', userR);
      users[sessionId] = {
        ...users[sessionId],
        activeUsers: [
          {
            ...userR,
            socketId: socket.id,
            isCustomerScreen: true,
            isConnected: false,
          },
        ],
      };
    }
    console.log('cust-screen', users[sessionId]?.activeUsers);
  });

  socket.on('disconnect', () => {
    for (const [sessionId, members] of Object.entries(users)) {
      const index = members?.activeUsers?.findIndex(
        (users) => users?.socketId === socket.id
      );
      if (index >= -1) {
        members?.activeUsers?.splice(index, 1);
      }
    }
    console.log('disconnect', users);
  });

  socket.on('callUser', ({ userToCall, signalData, from, sessionId }) => {
    const customerScreen = users[sessionId]?.activeUsers?.find(
      (user) => user?.isCustomerScreen
    );
    if (!customerScreen) {
      socket.emit('call-refused', { isCustomerScreen: false });
      return;
    }
    if (customerScreen?.isConnected) {
      socket.emit('call-refused', { isConnected: true });
      return;
    }
    console.log('customer-screen is here', customerScreen);
    io.to(customerScreen?.socketId).emit('callUser', {
      signal: signalData,
      from,
    });
  });

  socket.on('answerCall', (data) => {
    io.to(data.to).emit('callAccepted', data.signal);
  });

  socket.on('call_ended', ({ sessionId }) => {
    const customerScreen = users[sessionId]?.activeUsers?.find(
      (user) => user?.isCustomerScreen
    );
    io.to(customerScreen.socketId).emit('callEnded');
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
    const response = await axios.post(
      `${data.url}/api/user/authenticate`,
      body
    );
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
      socket.broadcast.emit('updated-live-screen', {
        order: 'saved',
      });
      return;
    }
    if (data?.order === 'discarded') {
      socket.broadcast.emit('updated-live-screen', {
        order: 'discarded',
      });
      return;
    }
    if (data?.order === 'paid') {
      socket.broadcast.emit('updated-live-screen', {
        order: 'paid',
      });
      return;
    }
    const order = JSON.parse(data?.order);
    const customer = data?.customer;
    const selectedPos = data?.selectedPos;
    socket.broadcast.emit('updated-live-screen', {
      order: order,
      customer: customer,
      selectedPos: selectedPos,
    });
  });
});

server.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
