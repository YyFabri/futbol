// server.js

// --- 1. Importar las librerías ---
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require("socket.io");

// --- 2. Configuración inicial ---
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- 3. Servir tu juego (el archivo HTML) ---
// Cuando alguien entre a tu link de Render, le mandamos el juego.html
app.get('/', (req, res) => {
  // Asegúrate que el nombre 'juego.html' coincida con tu archivo
  res.sendFile(path.join(__dirname, 'juego.html')); 
});

// --- 4. Almacenamiento de salas ---
// (Esto es temporal. Si el servidor se reinicia, se pierden las salas)
const activeRooms = {};

// Función para generar un código de 4 letras
function generateRoomCode() {
    let code = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    // Si el código ya existe, genera otro
    return activeRooms[code] ? generateRoomCode() : code;
}

// --- 5. Lógica del Servidor (¡Lo más importante!) ---
io.on('connection', (socket) => {
    console.log(`Usuario conectado: ${socket.id}`);

    // --- Escuchar el evento 'createRoom' del cliente ---
    socket.on('createRoom', () => {
        const roomCode = generateRoomCode();
        activeRooms[roomCode] = {
            players: [socket.id]
        };

        socket.join(roomCode); // Unir al creador a su propia sala
        
        console.log(`Sala ${roomCode} creada por ${socket.id}`);
        
        // --- Responder al cliente con el evento 'roomCreated' ---
        socket.emit('roomCreated', roomCode);
    });

    // --- Escuchar el evento 'joinRoom' del cliente ---
    socket.on('joinRoom', (roomCode) => {
        const room = activeRooms[roomCode];

        if (!room) {
            // Error: La sala no existe
            socket.emit('lobbyError', 'La sala no existe.');
            return;
        }

        // Opcional: Limitar jugadores. Por ahora lo dejamos abierto.
        // if (room.players.length >= 2) {
        //     socket.emit('lobbyError', 'La sala está llena.');
        //     return;
        // }

        room.players.push(socket.id);
        socket.join(roomCode); // Unir al jugador a la sala
        console.log(`Usuario ${socket.id} se unió a la sala ${roomCode}`);

        // --- Responder a TODOS en la sala con 'joinSuccess' ---
        io.to(roomCode).emit('joinSuccess', roomCode);
    });

    // --- Escuchar el evento 'playerReady' (que ya tienes en tu HTML) ---
    socket.on('playerReady', (data) => {
        // 'data' contiene { room, team, position }
        console.log(`Jugador ${socket.id} listo en sala ${data.room} como ${data.team} ${data.position}`);
        
        // Aquí es donde enviarás la info a los otros jugadores
        // (Lo veremos en el próximo paso, por ahora solo lo registramos)
    });


    // --- Limpieza cuando un jugador se desconecta ---
    socket.on('disconnect', () => {
        console.log(`Usuario desconectado: ${socket.id}`);
        // Recorrer todas las salas para sacar al jugador
        for (const roomCode in activeRooms) {
            const room = activeRooms[roomCode];
            const playerIndex = room.players.indexOf(socket.id);

            if (playerIndex !== -1) {
                room.players.splice(playerIndex, 1);
                console.log(`Jugador ${socket.id} salió de la sala ${roomCode}`);

                // Si la sala queda vacía, la eliminamos
                if (room.players.length === 0) {
                    delete activeRooms[roomCode];
                    console.log(`Sala ${roomCode} eliminada (vacía).`);
                }
                break;
            }
        }
    });
});

// --- 6. Iniciar el servidor ---
// Render te dará un puerto con process.env.PORT
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});