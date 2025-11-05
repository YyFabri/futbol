// server.js

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'juego.html')); 
});

const activeRooms = {};

function generateRoomCode() {
    let code = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return activeRooms[code] ? generateRoomCode() : code;
}

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
            ballAngularVelocity: { x: 0, y: 0, z: 0 },
            score: { blue: 0, red: 0 },
            kickoffActive: true,
            currentKickoffTeam: 'red',
            lastBallUpdate: Date.now(),
            ballAuthority: null // Quien tiene el control de la pelota
        }
    };
}

io.on('connection', (socket) => {
    console.log(`Usuario conectado: ${socket.id}`);

    socket.on('createRoom', () => {
        const roomCode = generateRoomCode();
        activeRooms[roomCode] = initializeRoomState();
        socket.join(roomCode);
        console.log(`Sala ${roomCode} creada por ${socket.id}`);
        socket.emit('roomCreated', roomCode);
    });

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

    socket.on('playerReady', (data) => {
        const room = activeRooms[data.room];
        if (!room) {
            socket.emit('lobbyError', 'La sala no existe.');
            return;
        }
        
        const previousPlayerInfo = room.players[socket.id];
        if (previousPlayerInfo) {
            room.occupiedPositions[previousPlayerInfo.team][previousPlayerInfo.position] = false;
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
        
        io.to(data.room).emit('playerPositionChanged', {
            playerId: socket.id,
            team: data.team,
            position: data.position,
            nickname: data.nickname
        });
        
        socket.emit('allPlayers', room.players);
    });

    socket.on('playerMove', (data) => {
        socket.to(data.room).emit('playerMoved', {
            playerId: socket.id,
            position: data.position,
            rotation: data.rotation,
            velocity: data.velocity
        });
    });

    // ===== NUEVO SISTEMA DE AUTORIDAD =====
    // El cliente solicita patear la pelota
    socket.on('requestKick', (data) => {
        const room = activeRooms[data.room];
        if (!room) return;

        const now = Date.now();
        const timeSinceLastUpdate = now - room.gameState.lastBallUpdate;
        
        // Solo permitir patadas si han pasado al menos 100ms desde la última actualización
        // Esto evita conflictos cuando dos jugadores patean simultáneamente
        if (timeSinceLastUpdate < 100 && room.gameState.ballAuthority !== socket.id) {
            // Rechazar la patada y enviar la posición actual de la pelota
            socket.emit('kickRejected', {
                position: room.gameState.ballPosition,
                velocity: room.gameState.ballVelocity,
                angularVelocity: room.gameState.ballAngularVelocity
            });
            return;
        }

        // Verificar kickoff
        const playerInfo = room.players[socket.id];
        if (room.gameState.kickoffActive && playerInfo) {
            if (playerInfo.team !== room.gameState.currentKickoffTeam) {
                socket.emit('kickRejected', {
                    position: room.gameState.ballPosition,
                    velocity: room.gameState.ballVelocity,
                    angularVelocity: room.gameState.ballAngularVelocity
                });
                return;
            }
            room.gameState.kickoffActive = false;
            io.to(data.room).emit('kickoffComplete');
        }

        // Actualizar estado de la pelota
        room.gameState.ballPosition = data.position;
        room.gameState.ballVelocity = data.velocity;
        room.gameState.ballAngularVelocity = data.angularVelocity || { x: 0, y: 0, z: 0 };
        room.gameState.lastBallUpdate = now;
        room.gameState.ballAuthority = socket.id;

        // Enviar a TODOS los clientes (incluido quien pateó) la actualización oficial
        io.to(data.room).emit('ballSync', {
            position: room.gameState.ballPosition,
            velocity: room.gameState.ballVelocity,
            angularVelocity: room.gameState.ballAngularVelocity,
            timestamp: now
        });

        // Liberar la autoridad después de 500ms
        setTimeout(() => {
            if (room.gameState.ballAuthority === socket.id) {
                room.gameState.ballAuthority = null;
            }
        }, 500);
    });

    // Actualización periódica de la pelota (para sincronización continua)
    socket.on('ballUpdate', (data) => {
        const room = activeRooms[data.room];
        if (!room) return;

        // Solo actualizar si este cliente tiene autoridad o si ha pasado suficiente tiempo
        const now = Date.now();
        const timeSinceLastUpdate = now - room.gameState.lastBallUpdate;
        
        if (room.gameState.ballAuthority === socket.id || timeSinceLastUpdate > 200) {
            room.gameState.ballPosition = data.position;
            room.gameState.ballVelocity = data.velocity;
            room.gameState.ballAngularVelocity = data.angularVelocity || { x: 0, y: 0, z: 0 };
            room.gameState.lastBallUpdate = now;
            
            socket.to(data.room).emit('ballSync', {
                position: data.position,
                velocity: data.velocity,
                angularVelocity: data.angularVelocity
            });
        }
    });

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
            room.gameState.ballAuthority = null; // Resetear autoridad
            io.to(data.room).emit('goalUpdate', {
                score: room.gameState.score,
                currentKickoffTeam: room.gameState.currentKickoffTeam
            });
        }
    });

    socket.on('kickoffTaken', (data) => {
        const room = activeRooms[data.room];
        if (room) {
            room.gameState.kickoffActive = false;
            io.to(data.room).emit('kickoffComplete');
        }
    });

    socket.on('requestRoomState', (roomCode) => {
        const room = activeRooms[roomCode];
        if (room) {
            socket.emit('roomState', {
                occupiedPositions: room.occupiedPositions,
                gameState: room.gameState,
                players: room.players
            });
        }
    });

    socket.on('disconnect', () => {
        console.log(`Usuario desconectado: ${socket.id}`);
        for (const roomCode in activeRooms) {
            const room = activeRooms[roomCode];
            const playerInfo = room.players[socket.id];
            if (playerInfo) {
                room.occupiedPositions[playerInfo.team][playerInfo.position] = false;
                delete room.players[socket.id];
                
                // Si este jugador tenía autoridad, liberarla
                if (room.gameState.ballAuthority === socket.id) {
                    room.gameState.ballAuthority = null;
                }
                
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});