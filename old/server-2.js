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
    'Origin, X-Requested-With, Content-Type, Accept',
  );
  next();
});

const PORT = process.env.PORT || 5000;

app.get('/', (req, res) => {
  res.send('Running');
});

const users = {};

io.on('connection', (socket) => {
  const queryParams = socket.handshake.query;
  const sessionId = queryParams.sessionId;
  const user = { ...JSON.parse(queryParams.user) };
  const screenType = queryParams.screenType;
  console.log('data', user, sessionId);

  //Add user to poll
  if (users[sessionId]) {
    if (users[sessionId]?.activeUsers) {
      if (
        users[sessionId]?.activeUsers?.find(
          (u) =>
            u?.screenType === 'live-customer' && screenType === 'live-customer',
        )
      ) {
        socket.emit('screen-exist');
        return;
      }
      users[sessionId].activeUsers = [
        ...users[sessionId]?.activeUsers,
        {
          ...user,
          screenType: screenType,
          socketId: socket.id,
        },
      ];
    } else {
      users[sessionId].activeUsers = [
        {
          ...user,
          screenType: screenType,
          socketId: socket.id,
        },
      ];
    }
  } else {
    users[sessionId] = {
      activeUsers: [
        {
          ...user,
          screenType: screenType,
          socketId: socket.id,
        },
      ],
    };
  }

  console.log('users-poll', users[sessionId]?.activeUsers);
  socket.join(Number(sessionId));

  socket.emit('connection-success', socket.id);

  //remove user from poll when disconnected
  socket.on('disconnect', () => {
    for (const [sessionId, members] of Object.entries(users)) {
      const index = members?.activeUsers?.findIndex(
        (users) => users?.socketId === socket.id,
      );
      const disconnectedScreen = members?.activeUsers[index];
      if (
        disconnectedScreen &&
        disconnectedScreen?.screenType === 'live-customer'
      ) {
        console.log({ disconnectedScreen, sessionId });
        io.in(Number(sessionId)).emit('customer-screen-disconnected', {
          sessionId: sessionId,
        });
      }
      if (index >= -1) {
        members?.activeUsers?.splice(index, 1);
      }
    }
  });

  socket.on('callUser', ({ userToCall, signalData, from, sessionId }) => {
    const customerScreen = users[sessionId]?.activeUsers?.find(
      (user) => user?.screenType === 'live-customer',
    );
    if (!customerScreen) {
      socket.emit('call-refused', { isCustomerScreen: false });
      return;
    }
    if (customerScreen?.isConnected) {
      socket.emit('call-refused', { isConnected: true });
      return;
    }
    console.log('im over here');
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
      (user) => user?.screenType === 'live-customer',
    );
    if (customerScreen) {
      io.to(customerScreen.socketId).emit('callEnded');
    }
  });
  socket.on('hide-operator-video', () => {
    const customerScreen = users[sessionId]?.activeUsers?.find(
      (user) => user?.screenType === 'live-customer',
    );
    console.log('hiding');
    io.to(customerScreen.socketId).emit('hide-operator-video');
  });
  socket.on('show-operator-video', () => {
    const customerScreen = users[sessionId]?.activeUsers?.find(
      (user) => user?.screenType === 'live-customer',
    );
    console.log('showing');
    io.to(customerScreen.socketId).emit('show-operator-video');
  });

  socket.on('agent-muted', (data) => {
    const { isMuted } = data;
    const customerScreen = users[sessionId]?.activeUsers?.find(
      (user) => user?.screenType === 'live-customer',
    );
    io.to(customerScreen?.socketId).emit('toggle-agent-mute', {
      isMuted: isMuted,
    });
  });

  socket.on('reset-customer-screen', (data) => {
    const customerScreen = users[sessionId]?.activeUsers?.filter(
      (user) =>
        user?.screenType === 'live-customer' || user?.screenType === 'live-kds',
    );
    if (customerScreen?.length) {
      customerScreen.forEach((screen) => {
        io.to(screen.socketId).emit('reset-screen');
      });
    }
  });

  socket.on('remove-customer-screen', () => {
    const customerScreens = users[sessionId]?.activeUsers?.filter(
      (user) => user?.screenType === 'live-customer',
    );
    if (customerScreens?.length) {
      customerScreens.forEach((screen) => {
        io.to(screen.socketId).emit('shut-down');
      });
      users[sessionId] = {
        activeUsers: [
          ...users[sessionId].activeUsers?.filter(
            (user) => user?.screenType !== 'live-customer',
          ),
        ],
      };
    }
    console.log('shut-down', users[sessionId]?.activeUsers);
  });

  socket.on('update_todays_orders_count', async (data) => {
    console.log('update_todays_orders_count', data.sessionId);
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
      console.log("data", data, 'response', response);
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
      body,
    );
    console.log('update_saved_orders_count');
    io.in(data.sessionId).emit('updated_saved_orders_count', {
      result: JSON.stringify(response?.data?.result),
    });
  });

  // socket.on('update_customer_points', async (data) => {
  //   try {
  //     const response = await axios.post(`${data.url}/api/user/authenticate`, {
  //       jsonrpc: '2.0',
  //       params: {
  //         db: data.database,
  //         email: data.email,
  //         password: data.password,
  //         api_type: 'customers_points',
  //       },
  //     });
  //     io.in(data.sessionId).emit('updated_kds_data', {
  //       response: JSON.stringify(response?.data),
  //     });
  //   } catch (error) {
  //     console.log(error);
  //   }
  // });

  socket.on('tap-to-pay-initiated', (data) => {
    io.in(data?.sessionId).emit('tap-to-pay-started');
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
