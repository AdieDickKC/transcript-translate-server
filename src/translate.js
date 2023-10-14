import translate from 'google-translate-api-x';
import { transcriptAvailServiceSub, transcriptSubject } from './globals.js';

// Array of languages that are supported and if there are any subscribers
let languages = [];


// TBD - make the payload of the Subject a json object that includes the service id

export const registerForTranscripts = (io) => {
    const transcriptSubscription = transcriptSubject.subscribe((transcript) => {
        //        console.log(`Received new transcript Subject: ${transcript}`);
        // Translate into our current language list
        languages.forEach(async (lang) => {
            let translation = await translateText(lang, transcript);
            //            console.log(`Translation in ${lang}: ${translation}`);

            // Send this language to all participants that are
            // subscribed to it
            io.to(lang).emit("translation", translation);
        })
    });
}

export const addTranslationLanguage = (lang) => {
    if (languages.indexOf(lang) === -1) {
        languages.push(lang);
    }
}

async function translateTextAndDistribute(data) {
    const { io, channel, lang, transcript } = data;
    try {
        console.log(`Attempting to translate ${transcript} into ${lang} for channel ${channel}`);
        const translated = await translate(transcript, { to: lang });
        console.log(`Sending to channel: ${channel} -> ${translated.text}`);
        io.to(channel).emit("translation", translated.text);
        return translated.text;
    } catch (error) {
        console.error(`Caught error in translateTextAndDistribute: ${error}`);
    }
}

// Service based methods

// data = {io, serviceId} 
export const registerForServiceTranscripts = (data) => {
    const { io, serviceId } = data;

    // Map of Services/Languages - Church Services are the keys, and array of 
    // languages the values
    let serviceLanguageMap = new Map();

    // Initialize the service  
    console.log(`Initializing language map for service: ${serviceId}`);
    serviceLanguageMap.set(serviceId, []);
    printLanguageMap(serviceLanguageMap);
    const test = serviceLanguageMap.get(serviceId);

    // Subscribe to a RxJs Subject to detect when transcripts are available
    const subscription = transcriptAvailServiceSub.subscribe(async (data) => {
        const { serviceCode, transcript, serviceLanguageMap } = data;

        console.log(`Received transcript: ${serviceCode} ${transcript}`);

        // Send the transcript to any subscribers 
        let channel = `${serviceCode}:transcript`;
        io.to(channel).emit("transcript", transcript);

        // Now send the translation to any subscribers.  First get the array
        // of currently subscribed languages for this service
        let languagesForChannel = serviceLanguageMap.get(serviceCode);
        //        printLanguageMap(serviceLanguageMap);

        if (languagesForChannel === undefined) {
            console.warn("Warning, language map is undefined");
            return;
        }

        // Now iterate over the languages, getting and emitting the translation
        // TBD - do this in parallel?
        //        for (lang in languagesForChannel) {
        languagesForChannel.forEach(async lang => {
            // update channel to have the language
            channel = `${serviceCode}:${lang}`;
            const data = { io, channel, lang, transcript };
            let translation = await translateTextAndDistribute(data);
        });
    });
    return serviceLanguageMap;
}

const printLanguageMap = (myMap) => {
    for (const [key, value] of myMap.entries()) {
        // value should be an array of strings
        value.forEach((val => {
            console.log(`key: ${key}, lang: ${val}`);
        }))
    }
}

export const printSubscribersPerLanguage = (data) => {
    const io = data.io;
    const sericeId = data.sericeId;
    const serviceLanguageMap = data.serviceLanguageMap;

    try {
        let languagesForChannel = serviceLanguageMap.get(serviceId);
        languagesForChannel.forEach(language => {
            const room = `${sericeId}:${language}`;
            const subscribers = io.sockets.adapter.rooms.get(room).size;
            console.log(`Subscribers for ${language}: ${subscribers}`);
        })
    } catch (error) {
        console.log(`Error printing subscribers`)
    }
}

// data = {serviceId, language}
export const addTranslationLanguageToService = (data) => {
    const { serviceId, language, serviceLanguageMap } = data;
    console.log(`Attempting to add ${language} to ${serviceId}`);

    if (serviceLanguageMap.get(serviceId) === undefined) {
        serviceLanguageMap.set(serviceId, language);
    } else {
        // only add language if it doesn't already exist
        let langArray = serviceLanguageMap.get(serviceId);
        if (langArray.indexOf(language) == -1) {
            langArray.push(language);
            serviceLanguageMap.set(serviceId, langArray);
        }
    }
    return serviceLanguageMap;
    //    printLanguageMap(serviceLanguageMap);
}

// data = {serviceId, language}
export const removeTranslationLanguageFromService = (data) => {
    const { serviceId, language, serviceLanguageMap } = data;
    let index = serviceLanguageMap.get(serviceId).indexOf(language);
    if (index !== -1) {
        serviceLanguageMap.get(serviceId).splice(index, 1);
    }
    return serviceLanguageMap;
}