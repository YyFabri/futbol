// server.js

// --- 1. Importar las librerías ---
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require("socket.io");
const CANNON = require('cannon-es');

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
    
    // Configurar un mundo de física por sala
    const world = new CANNON.World();
    world.gravity.set(0, -9.82, 0); // Gravedad
    world.defaultContactMaterial.friction = 0.1;

    // Crear el cuerpo de la pelota en el servidor
    const ballShape = new CANNON.Sphere(0.22); // ballRadius (de tu cliente)
    const ballBody = new CANNON.Body({
        mass: 0.43,
        shape: ballShape,
        linearDamping: 0.6,
        angularDamping: 0.2,
        material: new CANNON.Material({ friction: 0.2, restitution: 0.8 })
        // Nota: Los grupos de colisión se omiten aquí por simplicidad,
        // pero deberías añadirlos replicando tu lógica del cliente
    });
    ballBody.position.set(0, 0.32, 0); // Posición inicial
    world.addBody(ballBody);

    // --- AÑADIR EL SUELO FÍSICO (¡IMPORTANTE!) ---
    const groundShape = new CANNON.Plane();
    const groundBody = new CANNON.Body({ mass: 0 }); // Estático
    groundBody.addShape(groundShape);
    groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0); // Rotar para que sea plano
    world.addBody(groundBody);
    // --- FIN DE AÑADIR SUELO ---
    
    // (Deberías añadir también las paredes y porterías al 'world' del servidor)
    
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
            currentKickoffTeam: 'red',
            goalScoredRecently: false // <-- AÑADIDO
        },
        // --- Guardar el mundo y la pelota en la sala ---
        world: world,
        ballBody: ballBody,
        physicsInterval: null // Para manejar el bucle de física
    };
}

// --- 5. Lógica del Servidor ---
io.on('connection', (socket) => {
    console.log(`Usuario conectado: ${socket.id}`);

    // Crear sala
    socket.on('createRoom', () => {
        const roomCode = generateRoomCode();
        activeRooms[roomCode] = initializeRoomState();
        
        // --- Iniciar el bucle de física PARA ESTA SALA ---
        activeRooms[roomCode].physicsInterval = setInterval(() => {
            gameLoop(roomCode);
        }, 1000 / 60); // 60 veces por segundo
        // ------------------------------------------------
        
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
        
        // Si el jugador ya tenía una posición, liberarla primero
        const previousPlayerInfo = room.players[socket.id];
        if (previousPlayerInfo) {
            room.occupiedPositions[previousPlayerInfo.team][previousPlayerInfo.position] = false;
        }
        
        // Verificar si la posición está ocupada (por OTRO jugador)
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
        
        // Notificar a TODOS (incluido el que cambió) sobre el cambio de posición
        io.to(data.room).emit('playerPositionChanged', {
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

    // --- AÑADE EL NUEVO 'playerKicked' ---
    socket.on('playerKicked', (data) => {
        const room = activeRooms[data.room];
        if (room && room.ballBody) {
            
            // Aquí puedes añadir tu lógica de kickoff si quieres
            // if (room.gameState.kickoffActive && ...) { ... }

            // Aplicar la patada en la física del SERVIDOR
            room.ballBody.velocity.setZero();
            room.ballBody.angularVelocity.setZero();
            
            const impulseVec = new CANNON.Vec3(data.impulse.x, data.impulse.y, data.impulse.z);
            room.ballBody.applyImpulse(impulseVec, room.ballBody.position);
            
            if (data.angularVelocity) {
                const angularVec = new CANNON.Vec3(data.angularVelocity.x, data.angularVelocity.y, data.angularVelocity.z);
                room.ballBody.angularVelocity.copy(angularVec);
            }
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

    // Solicitar estado actualizado de la sala
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
                    
                    // Limpiar el intervalo de física antes de borrar la sala
                    if (room.physicsInterval) {
                        clearInterval(room.physicsInterval);
                    }
                    
                    delete activeRooms[roomCode];
                    console.log(`Sala ${roomCode} eliminada (vacía).`);
                }
                break;
            }
        }
    });
});


// --- Bucle de Juego del Servidor ---
function gameLoop(roomCode) {
    const room = activeRooms[roomCode];
    if (!room) return;

    // 1. Avanzar la física
    room.world.step(1 / 60); // 1/60 = 60 FPS

    // --- 2. Lógica de Detección de Gol (¡AHORA EN EL SERVIDOR!) ---
    if (!room.gameState.goalScoredRecently) {
        const bx = room.ballBody.position.x;
        const by = room.ballBody.position.y;
        const bz = room.ballBody.position.z;
        const r = 0.22; // ballRadius
        const halfFieldLength = 45; // fieldLength / 2
        const halfGoalWidth = 6;    // goalWidth / 2
        const goalHeight = 4;

        let scoringTeam = null;

        // Gol en portería NORTE (z positiva) -> Anota equipo AZUL
        if ((bz - r) > halfFieldLength && Math.abs(bx) + r < halfGoalWidth && (by - r) < goalHeight) {
            scoringTeam = 'blue';
        }

        // Gol en portería SUR (z negativa) -> Anota equipo ROJO
        if ((bz + r) < -halfFieldLength && Math.abs(bx) + r < halfGoalWidth && (by - r) < goalHeight) {
            scoringTeam = 'red';
        }

        if (scoringTeam) {
            room.gameState.goalScoredRecently = true; // Prevenir goles múltiples
            
            if (scoringTeam === 'blue') {
                room.gameState.score.blue++;
                room.gameState.currentKickoffTeam = 'red';
            } else {
                room.gameState.score.red++;
                room.gameState.currentKickoffTeam = 'blue';
            }
            room.gameState.kickoffActive = true;

            // Notificar a todos los clientes sobre el gol
            io.to(roomCode).emit('goalUpdate', {
                score: room.gameState.score,
                currentKickoffTeam: room.gameState.currentKickoffTeam
            });

            // Resetear la pelota en el servidor después de 3 seg
            setTimeout(() => {
                if (activeRooms[roomCode]) { // Asegurarse que la sala aún exista
                    room.ballBody.position.set(0, 0.32, 0);
                    room.ballBody.velocity.set(0, 0, 0);
                    room.ballBody.angularVelocity.set(0, 0, 0);
                    room.gameState.kickoffActive = true;
                    room.gameState.goalScoredRecently = false;
                }
            }, 3000);
        }
    }
    // --- Fin Lógica de Gol ---


    // 3. Retransmitir el estado autoritativo a TODOS en la sala
    io.to(roomCode).emit('ballSync', {
        position: room.ballBody.position,
        velocity: room.ballBody.velocity,
        angularVelocity: room.ballBody.angularVelocity
    });
}



// --- 6. Iniciar el servidor ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});