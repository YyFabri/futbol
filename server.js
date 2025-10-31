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
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'juego.html')); 
});

// --- 4. Almacenamiento de salas ---
const activeRooms = {};

// Función para generar un código de 4 letras
function generateRoomCode() {
    let code = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return activeRooms[code] ? generateRoomCode() : code;
}

// Función para inicializar el estado de una sala
function initializeRoomState() {
    return {
        players: {},
        occupiedPositions: {
            blue: { gk: false, 'def-left': false, 'def-right': false, 'fwd-left': false, 'fwd-right': false },
            red: { gk: false, 'def-left': false, 'def-right': false, 'fwd-left': false, 'fwd-right': false }
        },
        gameState: {
            ballPosition: { x: 0, y: 0.32, z: 0 },
            ballVelocity: { x: 0, y: 0, z: 0 },
            score: { blue: 0, red: 0 },
            kickoffActive: true,
            currentKickoffTeam: 'red'
        }
    };
}

// --- 5. Lógica del Servidor ---
io.on('connection', (socket) => {
    console.log(`Usuario conectado: ${socket.id}`);

    // Crear sala
    socket.on('createRoom', () => {
        const roomCode = generateRoomCode();
        activeRooms[roomCode] = initializeRoomState();
        socket.join(roomCode);
        console.log(`Sala ${roomCode} creada por ${socket.id}`);
        socket.emit('roomCreated', roomCode);
    });

    // Unirse a sala
    socket.on('joinRoom', (roomCode) => {
        const room = activeRooms[roomCode];
        if (!room) {
            socket.emit('lobbyError', 'La sala no existe.');
            return;
        }
        socket.join(roomCode);
        console.log(`Usuario ${socket.id} se unió a la sala ${roomCode}`);
        socket.emit('joinSuccess', roomCode);
        socket.emit('roomState', {
            occupiedPositions: room.occupiedPositions,
            gameState: room.gameState,
            players: room.players
        });
    });

    // Jugador listo
    socket.on('playerReady', (data) => {
        const room = activeRooms[data.room];
        if (!room) {
            socket.emit('lobbyError', 'La sala no existe.');
            return;
        }
        if (room.occupiedPositions[data.team][data.position]) {
            socket.emit('positionOccupied', 'Esta posición ya está ocupada.');
            return;
        }
        room.occupiedPositions[data.team][data.position] = true;
        room.players[socket.id] = {
            team: data.team,
            position: data.position,
            nickname: data.nickname
        };
        console.log(`Jugador ${socket.id} (${data.nickname}) listo en sala ${data.room} como ${data.team} ${data.position}`);
        io.to(data.room).emit('playerJoined', {
            playerId: socket.id,
            team: data.team,
            position: data.position,
            nickname: data.nickname
        });
        socket.emit('allPlayers', room.players);
    });

    // Sincronizar movimiento
    socket.on('playerMove', (data) => {
        socket.to(data.room).emit('playerMoved', {
            playerId: socket.id,
            position: data.position,
            rotation: data.rotation,
            velocity: data.velocity
        });
    });

    // Sincronizar pelota
    socket.on('ballUpdate', (data) => {
        const room = activeRooms[data.room];
        if (room) {
            room.gameState.ballPosition = data.position;
            room.gameState.ballVelocity = data.velocity;
            socket.to(data.room).emit('ballSync', {
                position: data.position,
                velocity: data.velocity,
                angularVelocity: data.angularVelocity
            });
        }
    });

    // Sincronizar goles
    socket.on('goalScored', (data) => {
        const room = activeRooms[data.room];
        if (room) {
            if (data.team === 'blue') {
                room.gameState.score.blue++;
            } else {
                room.gameState.score.red++;
            }
            room.gameState.currentKickoffTeam = data.team === 'blue' ? 'red' : 'blue';
            room.gameState.kickoffActive = true;
            io.to(data.room).emit('goalUpdate', {
                score: room.gameState.score,
                currentKickoffTeam: room.gameState.currentKickoffTeam
            });
        }
    });

    // Saque inicial
    socket.on('kickoffTaken', (data) => {
        const room = activeRooms[data.room];
        if (room) {
            room.gameState.kickoffActive = false;
            io.to(data.room).emit('kickoffComplete');
        }
    });

    // Desconexión
    socket.on('disconnect', () => {
        console.log(`Usuario desconectado: ${socket.id}`);
        for (const roomCode in activeRooms) {
            const room = activeRooms[roomCode];
            const playerInfo = room.players[socket.id];
            if (playerInfo) {
                room.occupiedPositions[playerInfo.team][playerInfo.position] = false;
                delete room.players[socket.id];
                console.log(`Jugador ${socket.id} salió de la sala ${roomCode}`);
                io.to(roomCode).emit('playerLeft', socket.id);
                if (Object.keys(room.players).length === 0) {
                    delete activeRooms[roomCode];
                    console.log(`Sala ${roomCode} eliminada (vacía).`);
                }
                break;
            }
        }
    });
});

// --- 6. Iniciar el servidor ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});