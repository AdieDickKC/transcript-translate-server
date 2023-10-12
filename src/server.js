import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import * as dotenv from 'dotenv';
import http from 'http';
import path from 'path';
import { Server } from 'socket.io';
import {
    setupDeepgram, shutdownDeepgram, getCurrentDeepgramState,
    sendMicStreamToDeepgram, sendUrlStreamToDeepgram, abortStream, startupDeepgram, printDeepgramState
} from './deepgram.js';
import { registerForTranscripts, addTranslationLanguage } from './translate.js';
import { transcriptSubject } from "./globals.js";

// Firebase
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';

// Deepgram needs to be imported as CommonJS
import pkg from "@deepgram/sdk";
const { Deepgram } = pkg;
const deepgram = new Deepgram(process.env.DEEPGRAM_API_KEY);

// Environment variables
dotenv.config();

const app = express();
const server = http.createServer(app);

const url = "http://stream.live.vc.bbcmedia.co.uk/bbc_world_service";

let deepgramObj;

app.use(cors());
const io = new Server(server, {
    path: '/socket.io',
    cors: {
        origin: "*"
    }
});


// Register the translation service to receive the transcripts
registerForTranscripts(io);

// Create a namespace for admin control features
const controlNsp = io.of('/admin-control');
controlNsp.on('connection', (socket) => {
    // Socket.io controls
    console.log(`Client connected to our socket.io admin namespace`);
    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });

    // Deepgram Controls
    socket.on('deepgram_connect', () => {
        console.log(`Deepgram connect requested`);
        deepgramObj = setupDeepgram(io);
        startupDeepgram(deepgramObj);
    });
    socket.on('deepgram_disconnect', () => {
        console.log(`Deepgram disconnect requested`);
        shutdownDeepgram(deepgramObj);
    });
    socket.on('deepgram_state_request', () => {
        console.log(`Deepgram state requested`);
        const state = getCurrentDeepgramState(deepgramObj);
        console.log(`Current state of deepgram is: ${printDeepgramState(state)}`);
        io.emit('deepgram_state', (state));
    });

    // Streaming Controls
    socket.on('streaming_start', () => {
        console.log(`Streaming started`);
        sendUrlStreamToDeepgram(deepgramObj, url);
    });
    socket.on('streaming_stop', () => {
        console.log(`Streaming stopped`);
        abortStream();
    });

    // Audio stream from client mic
    socket.on('audio_available', (audio) => {
        sendMicStreamToDeepgram(deepgramObj, audio);
    })
})

// Websocket connection to the client
io.on('connection', (socket) => {
    console.log(`Client connected to our socket.io public namespace`);
    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });

    // Translation Rooms
    socket.on('subscribe', async (channel) => {
        console.log(`Subscribed call to room: ${channel}`);
        socket.join(channel);
        addTranslationLanguage(channel);
        console.log(`Current rooms: ${JSON.stringify(socket.rooms)}`);
    });
    socket.on('unsubscribe', (channel) => {
        console.log(`Unsubscribing from ${channel}`);
        socket.leave(channel);
    });

    // Transcripts directly from Deepgram
    socket.on('transcript', (transcript) => {
        io.emit('transcript', transcript);
        console.log(`Transcript received by server: ${transcript}`);
    });

    // Transcripts from the client (not directly from Deepgram)
    socket.on('transcriptReady', (transcript) => {
        io.emit('transcript', transcript);    
        transcriptSubject.next(transcript);
    })
});

const firebaseConfig = {
    apiKey: "AIzaSyAYS7YuGPQiJRT07_iZ3QXKPOmZUFNu1LI",
    authDomain: "realtimetranslation-583a6.firebaseapp.com",
    projectId: "realtimetranslation-583a6",
    storageBucket: "realtimetranslation-583a6.appspot.com",
    messagingSenderId: "184731763616",
    appId: "1:184731763616:web:9577e01a13863eb4861ac5",
    measurementId: "G-VHQ2V60SGS"
};
const firebaseApp = initializeApp(firebaseConfig);
const firebaseAuth = getAuth(firebaseApp);


// Middleware to check if user is authenticated
const isAuthenticated = (req, res, next) => {
    const user = firebaseAuth.currentUser;
    if (user !== null) {
        next();
    } else {
        res.redirect('/login');
    }
}

app.use(express.static("public"));
app.use(express.json());

// Login handler
app.post('/login', bodyParser.urlencoded({ extended: true }), async (req, res) => {
    const { email, password } = req.body;

    try {
        await signInWithEmailAndPassword(firebaseAuth, email, password);
        res.redirect('/admin');
    } catch (error) {
        console.error(error);
        //      res.status(401).send('Unauthorized');
        res.redirect('/');
    }
});

// Auth handler for keys
app.post('/auth', async (req, res) => {
    try {
        const { serviceId, churchKey } = req.body
        if (req.body.churchKey != process.env.CHURCH_KEY) {
            return res.json({ error: 'Key is missing or incorrect' })
        }
        const newKey = await deepgram.keys.create(
            process.env.DEEPGRAM_PROJECT,
            'Temporary key - works for 10 secs',
            ['usage:write'],
            { timeToLive: 10 }
        )
        res.json({ deepgramToken: newKey.key })
    } catch (error) {
        console.error(`Caught error in auth: ${error}`);
        res.json({ error })
    }
});

// Logout handler
app.get('/logout', (req, res) => {
    firebaseAuth.signOut();
    res.redirect('/login');
});
//
//
//// Serve the Web app
//app.use('/', isAuthenticated);
//app.get('/', (req, res) => {
//    const user = firebaseAuth.currentUser;
//    console.log(`Allowing in ${user.displayName}`);
//    res.sendFile(__dirname, + '/public/index.html');
//});
const __dirname = path.resolve(path.dirname(''));
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/views/index.html');
})
app.get('/admin', isAuthenticated, (req, res) => {
    res.sendFile(__dirname + '/views/admin.html');
})
app.get('/login', (req, res) => {
    res.sendFile(__dirname + '/views/login.html');
})
app.get('/participant', (req, res) => {
    res.sendFile(__dirname + '/views/participant.html');
})
app.get('/control', (req, res) => {
    res.sendFile(__dirname + '/views/control.html');
})

server.listen(3000, () => {
    console.log('listening on *:3000');
});