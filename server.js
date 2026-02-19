const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e8 });

app.use(express.static("public"));

const ADMIN = "Admin"; // ← поменяй на свой ник

let accounts = {};        // username -> { password }
let onlineUsers = {};     // username -> socket.id
let privateMessages = {}; // room -> messages[]

function getRoom(a,b){
  return [a,b].sort().join("_");
}

io.on("connection",(socket)=>{

  // ===== РЕГИСТРАЦИЯ =====
  socket.on("register",(data,cb)=>{
    const {username,password} = data;

    if(accounts[username])
      return cb({success:false,message:"Ник уже занят"});

    accounts[username] = { password };
    cb({success:true});
  });

  // ===== ЛОГИН =====
  socket.on("login",(data,cb)=>{
    const {username,password} = data;

    if(!accounts[username])
      return cb({success:false,message:"Аккаунта не существует"});

    if(accounts[username].password !== password)
      return cb({success:false,message:"Неверный пароль"});

    if(onlineUsers[username])
      return cb({success:false,message:"Аккаунт уже онлайн"});

    socket.username = username;
    onlineUsers[username] = socket.id;

    cb({success:true,admin: username === ADMIN});
    io.emit("users",Object.keys(onlineUsers));
  });

  // ===== ГЛОБАЛ ЧАТ =====
  socket.on("send_global",(msg)=>{
    io.emit("new_global",msg);
  });

  // ===== ЛС =====
  socket.on("send_private",({to,message})=>{
    const room = getRoom(socket.username,to);

    if(!privateMessages[room])
      privateMessages[room] = [];

    privateMessages[room].push(message);

    if(onlineUsers[to])
      io.to(onlineUsers[to]).emit("new_private",message);

    socket.emit("new_private",message);
  });

  socket.on("load_private",(other)=>{
    const room = getRoom(socket.username,other);
    socket.emit("private_history",privateMessages[room] || []);
  });

  // ===== ОТКЛЮЧЕНИЕ =====
  socket.on("disconnect",()=>{
    if(socket.username){
      delete onlineUsers[socket.username];
      io.emit("users",Object.keys(onlineUsers));
    }
  });

});

server.listen(3000,()=>console.log("Asylumgram PRO Part 1 running"));