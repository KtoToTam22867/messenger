const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));
app.use(express.json({limit:"50mb"}));

let users = {};
let online = {};

if (fs.existsSync("users.json")) {
  users = JSON.parse(fs.readFileSync("users.json"));
}

function saveUsers(){
  fs.writeFileSync("users.json", JSON.stringify(users,null,2));
}

io.on("connection", socket => {

  socket.on("register", (data, cb)=>{
    if(users[data.username]) return cb({success:false,message:"Ник занят"});
    users[data.username]={password:data.password,avatar:null};
    saveUsers();
    cb({success:true});
  });

  socket.on("login", (data, cb)=>{
    if(!users[data.username]) return cb({success:false,message:"Нет такого пользователя"});
    if(users[data.username].password!==data.password)
      return cb({success:false,message:"Неверный пароль"});
    online[data.username]=socket.id;
    socket.username=data.username;
    cb({success:true,avatar:users[data.username].avatar});
    io.emit("online",Object.keys(online));
  });

  socket.on("setAvatar",(img)=>{
    if(!socket.username) return;
    users[socket.username].avatar=img;
    saveUsers();
  });

  socket.on("send_global",(msg)=>{
    io.emit("new_global",msg);
  });

  socket.on("send_private",(data)=>{
    const target=online[data.to];
    if(target){
      io.to(target).emit("new_private",data);
    }
  });

  socket.on("call",(data)=>{
    const target=online[data.to];
    if(target) io.to(target).emit("call",data);
  });

  socket.on("signal",(data)=>{
    const target=online[data.to];
    if(target) io.to(target).emit("signal",data);
  });

  socket.on("disconnect",()=>{
    if(socket.username){
      delete online[socket.username];
      io.emit("online",Object.keys(online));
    }
  });

});

server.listen(3000);