const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e8 });

app.use(express.static("public"));

let users = {}; // username -> socket.id
let privateMessages = {};

function getRoom(a,b){
  return [a,b].sort().join("_");
}

function generateUniqueName(name){
  let newName = name;
  while(users[newName]){
    newName = name + "#" + Math.floor(Math.random()*9999);
  }
  return newName;
}

io.on("connection",(socket)=>{

  socket.on("join", name=>{
    const uniqueName = generateUniqueName(name);
    socket.username = uniqueName;
    users[uniqueName] = socket.id;

    socket.emit("your_name", uniqueName);
    io.emit("users", Object.keys(users));
  });

  socket.on("send_global", msg=>{
    io.emit("new_global", msg);
  });

  socket.on("send_private", ({to,message})=>{
    const room = getRoom(socket.username,to);
    if(!privateMessages[room]) privateMessages[room]=[];
    privateMessages[room].push(message);

    if(users[to])
      io.to(users[to]).emit("new_private", message);

    socket.emit("new_private", message);
  });

  socket.on("load_private", other=>{
    const room = getRoom(socket.username,other);
    socket.emit("private_history", privateMessages[room]||[]);
  });

  socket.on("disconnect", ()=>{
    delete users[socket.username];
    io.emit("users", Object.keys(users));
  });

});

server.listen(3000,()=>console.log("Asylumgram v7 running"));