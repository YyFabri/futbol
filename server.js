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

// REEMPLAZA ESTA FUNCIÓN COMPLETA en server.js

function initializeRoomState() {
    
    // Configurar un mundo de física por sala
    const world = new CANNON.World();
    world.gravity.set(0, -9.82, 0);
    world.defaultContactMaterial.friction = 0.1;

    // --- Crear el cuerpo de la pelota en el servidor ---
    const ballShape = new CANNON.Sphere(0.22); // ballRadius
    const ballBody = new CANNON.Body({
        mass: 0.43,
        shape: ballShape,
        linearDamping: 0.6,
        angularDamping: 0.2,
        material: new CANNON.Material({ friction: 0.2, restitution: 0.8 })
    });
    ballBody.position.set(0, 0.32, 0);
    world.addBody(ballBody);

    // --- AÑADIR SUELO ---
    const groundShape = new CANNON.Plane();
    const groundBody = new CANNON.Body({ mass: 0 });
    groundBody.addShape(groundShape);
    groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    world.addBody(groundBody);
    
    // --- AÑADIR PAREDES (Copiado de createWalls) ---
    const fieldWidth = 50;
    const fieldLength = 90;
    const goalDepth = 3;
    const goalHeight = 4;
    const wallHeight = 20;
    const goalWidth = 12;
    const wallMat = new CANNON.Material({ friction: 0.1, restitution: 0.9 });
    const sideSegmentWidth = (fieldWidth - goalWidth) / 2;
    const leftSegmentCenterX = -(fieldWidth + goalWidth) / 4;
    const rightSegmentCenterX = (fieldWidth + goalWidth) / 4;
    const backZ = fieldLength / 2 + 0.5;
    const frontZ = -fieldLength / 2 - 0.5;

    const walls = [
        { x: fieldWidth / 2 + 0.5, z: 0, w: 1, d: fieldLength },
        { x: -fieldWidth / 2 - 0.5, z: 0, w: 1, d: fieldLength },
        { x: leftSegmentCenterX, z: backZ, w: sideSegmentWidth, d: 1 },
        { x: rightSegmentCenterX, z: backZ, w: sideSegmentWidth, d: 1 },
        { x: leftSegmentCenterX, z: frontZ, w: sideSegmentWidth, d: 1 },
        { x: rightSegmentCenterX, z: frontZ, w: sideSegmentWidth, d: 1 },
    ];
    walls.forEach(wall => {
        const shape = new CANNON.Box(new CANNON.Vec3(wall.w / 2, wallHeight / 2, wall.d / 2));
        const body = new CANNON.Body({ mass: 0, material: wallMat });
        body.addShape(shape);
        body.position.set(wall.x, wallHeight / 2, wall.z);
        world.addBody(body);
    });
    // Techos (Copiado de createWalls)
    const ceilingHeight = goalHeight;
    const ceilingThickness = 0.5;
    const fieldCenterLength = fieldLength - (goalDepth * 2);
    const sideCeilingWidth = (fieldWidth - goalWidth) / 2;
    const ceilings = [
        { x: 0, z: 0, w: fieldWidth, d: fieldCenterLength },
        { x: -(fieldWidth + goalWidth) / 4, z: fieldLength / 2, w: sideCeilingWidth, d: goalDepth },
        { x: (fieldWidth + goalWidth) / 4, z: fieldLength / 2, w: sideCeilingWidth, d: goalDepth },
        { x: -(fieldWidth + goalWidth) / 4, z: -fieldLength / 2, w: sideCeilingWidth, d: goalDepth },
        { x: (fieldWidth + goalWidth) / 4, z: -fieldLength / 2, w: sideCeilingWidth, d: goalDepth }
    ];
    ceilings.forEach(ceiling => {
        const shape = new CANNON.Box(new CANNON.Vec3(ceiling.w / 2, ceilingThickness / 2, ceiling.d / 2));
        const body = new CANNON.Body({ mass: 0, material: wallMat });
        body.addShape(shape);
        body.position.set(ceiling.x, ceilingHeight, ceiling.z);
        world.addBody(body);
    });

    // --- AÑADIR REDES DE PORTERÍA (Copiado de createGoals) ---
    const netMat = new CANNON.Material({ friction: 0.1, restitution: 0.1 });
    const createOneGoalPhysics = (zPos) => {
        const netThickness = 0.2;
        const netZOffset = zPos > 0 ? goalDepth / 2 : -goalDepth / 2;
        const backNetShape = new CANNON.Box(new CANNON.Vec3(goalWidth / 2, goalHeight / 2, netThickness / 2));
        const backNetBody = new CANNON.Body({ mass: 0, material: netMat });
        backNetBody.addShape(backNetShape);
        backNetBody.position.set(0, goalHeight / 2, zPos + netZOffset);
        world.addBody(backNetBody);
        const sideNetShape = new CANNON.Box(new CANNON.Vec3(netThickness / 2, goalHeight / 2, goalDepth / 2));
        const leftNetBody = new CANNON.Body({ mass: 0, material: netMat });
        leftNetBody.addShape(sideNetShape);
        leftNetBody.position.set(-goalWidth / 2 - netThickness / 2, goalHeight / 2, zPos + netZOffset);
        world.addBody(leftNetBody);
        const rightNetBody = new CANNON.Body({ mass: 0, material: netMat });
        rightNetBody.addShape(sideNetShape);
        rightNetBody.position.set(goalWidth / 2 + netThickness / 2, goalHeight / 2, zPos + netZOffset);
        world.addBody(rightNetBody);
    };
    createOneGoalPhysics(fieldLength / 2); createOneGoalPhysics(-fieldLength / 2);
    
    // --- AÑADIR IDENTIFICADORES (Copiado de createFieldIdentifiers) ---
    const identifierHeight = 8; const identifierWidth = 15; const identifierDepth = 0.5;
    const blueShape = new CANNON.Box(new CANNON.Vec3(identifierWidth / 2, identifierHeight / 2, identifierDepth / 2));
    const blueBody = new CANNON.Body({ mass: 0 });
    blueBody.addShape(blueShape);
    blueBody.position.set(0, identifierHeight / 2, -fieldLength / 2 - 1);
    world.addBody(blueBody);
    const redShape = new CANNON.Box(new CANNON.Vec3(identifierWidth / 2, identifierHeight / 2, identifierDepth / 2));
    const redBody = new CANNON.Body({ mass: 0 });
    redBody.addShape(redShape);
    redBody.position.set(0, identifierHeight / 2, fieldLength / 2 + 1);
    world.addBody(redBody);

    // --- FIN DE OBJETOS FÍSICOS ---

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
            goalScoredRecently: false,
            isBallOutOfBounds: false // <--- AÑADE ESTA LÍNEA
        },
        world: world,
        ballBody: ballBody,
        physicsInterval: null
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


// REEMPLAZA ESTA FUNCIÓN en server.js

function gameLoop(roomCode) {
    const room = activeRooms[roomCode];
    if (!room) return;

    // 1. Avanzar la física
    room.world.step(1 / 60); // 60 FPS

    // 2. Lógica de Detección de Gol y Fuera de Banda
    // --- NUEVO ---
    // Solo chequear si no se está reseteando por gol O por fuera de banda
    if (!room.gameState.goalScoredRecently && !room.gameState.isBallOutOfBounds) {
        const bx = room.ballBody.position.x;
        const by = room.ballBody.position.y;
        const bz = room.ballBody.position.z;
        const r = 0.22;
        const halfFieldLength = 45;
        const halfGoalWidth = 6;
        const goalHeight = 4;
        const halfFieldWidth = 25; // <--- NUEVO --- (Límite lateral)
        
        let scoringTeam = null;

        // Lógica de Gol (sin cambios)
        if ((bz - r) > halfFieldLength && Math.abs(bx) + r < halfGoalWidth && (by - r) < goalHeight) {
            scoringTeam = 'blue';
        }
        if ((bz + r) < -halfFieldLength && Math.abs(bx) + r < halfGoalWidth && (by - r) < goalHeight) {
            scoringTeam = 'red';
        }

        if (scoringTeam) {
            // Manejo de Gol (sin cambios)
            room.gameState.goalScoredRecently = true;
            if (scoringTeam === 'blue') {
                room.gameState.score.blue++;
                room.gameState.currentKickoffTeam = 'red';
            } else {
                room.gameState.score.red++;
                room.gameState.currentKickoffTeam = 'blue';
            }
            room.gameState.kickoffActive = true;
            io.to(roomCode).emit('goalUpdate', {
                score: room.gameState.score,
                currentKickoffTeam: room.gameState.currentKickoffTeam
            });
            setTimeout(() => {
                if (activeRooms[roomCode]) {
                    room.ballBody.position.set(0, 0.32, 0);
                    room.ballBody.velocity.set(0, 0, 0);
                    room.ballBody.angularVelocity.set(0, 0, 0);
                    room.gameState.kickoffActive = true;
                    room.gameState.goalScoredRecently = false;
                }
            }, 3000);

        // --- INICIO DE LA LÓGICA DE FUERA DE BANDA ---
        } else if (Math.abs(bx) - r > halfFieldWidth || Math.abs(bz) - r > halfFieldLength) {
            // Si no fue gol, pero está fuera de los límites laterales (X) O de fondo (Z)...
            
            room.gameState.isBallOutOfBounds = true; // Activar el flag
            
            // Esperar 2 segundos para resetear
            setTimeout(() => {
                if (activeRooms[roomCode]) { // Comprobar si la sala aún existe
                    // Poner la pelota en el centro y ARRIBA (para que caiga)
                    room.ballBody.position.set(0, 5, 0); // y=5 está en el aire
                    room.ballBody.velocity.set(0, 0, 0);
                    room.ballBody.angularVelocity.set(0, 0, 0);
                    
                    // Quitar el flag para reanudar el juego
                    room.gameState.isBallOutOfBounds = false;
                }
            }, 2000); // 2 segundos
        }
        // --- FIN DE LA LÓGICA DE FUERA DE BANDA ---
    }

    // 3. Retransmitir el estado autoritativo (sin cambios)
    io.to(roomCode).emit('ballSync', {
        position: room.ballBody.position,
        quaternion: room.ballBody.quaternion 
    });
}



// --- 6. Iniciar el servidor ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});