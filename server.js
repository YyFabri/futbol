// server.js
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
// Inicializa Socket.IO en el servidor
const io = new Server(server);

// Sirve tu archivo HTML principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'juego.html'));
});

// Almacena las salas activas.
// En un proyecto real, usarías una base de datos, pero esto funciona.
const activeRooms = {};

// Función para generar un código de sala aleatorio (4 letras)
function generateRoomCode() {
    let code = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    // Asegurarse de que el código no exista ya
    if (activeRooms[code]) {
        return generateRoomCode();
    }
    return code;
}


// Eventos de Socket.IO
io.on('connection', (socket) => {
    console.log(`Usuario conectado: ${socket.id}`);

    // --- 1. Evento para CREAR SALA ---
    socket.on('createRoom', () => {
        const roomCode = generateRoomCode();
        activeRooms[roomCode] = {
            players: [socket.id]
            // Aquí podrías guardar más info de la sala, como el marcador, etc.
        };

        socket.join(roomCode); // Une al creador a su propia sala
        console.log(`Sala ${roomCode} creada por ${socket.id}`);
        
        // Avisa SÓLO al creador que la sala se creó y le da el código
        socket.emit('roomCreated', roomCode);
    });

    // --- 2. Evento para UNIRSE A SALA ---
    socket.on('joinRoom', (roomCode) => {
        const room = activeRooms[roomCode];

        if (!room) {
            // Error: La sala no existe
            socket.emit('lobbyError', 'La sala no existe.');
            return;
        }

        // Lógica simple (luego puedes limitarlo a 2, 4, etc.)
        // if (room.players.length >= 2) {
        //     socket.emit('lobbyError', 'La sala está llena.');
        //     return;
        // }

        room.players.push(socket.id);
        socket.join(roomCode); // Une al jugador a la sala
        console.log(`Usuario ${socket.id} se unió a la sala ${roomCode}`);

        // Avisa a TODOS en la sala (incluido el nuevo) que alguien se unió
        io.to(roomCode).emit('joinSuccess', roomCode);
    });

    // --- 3. Evento de Desconexión ---
    socket.on('disconnect', () => {
        console.log(`Usuario desconectado: ${socket.id}`);
        // Lógica para limpiar salas si el jugador se va
        for (const roomCode in activeRooms) {
            const index = activeRooms[roomCode].players.indexOf(socket.id);
            if (index !== -1) {
                activeRooms[roomCode].players.splice(index, 1);
                
                // Si la sala queda vacía, la borramos
                if (activeRooms[roomCode].players.length === 0) {
                    delete activeRooms[roomCode];
                    console.log(`Sala ${roomCode} eliminada (vacía).`);
                }
                break;
            }
        }
    });
});


// Iniciar el servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});