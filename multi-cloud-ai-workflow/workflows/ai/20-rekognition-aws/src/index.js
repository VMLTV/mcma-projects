//"use strict";

// require
const util = require("util");

const AWS = require("aws-sdk");
const S3 = new AWS.S3();
const S3GetObject = util.promisify(S3.getObject.bind(S3));

const { EnvironmentVariableProvider } = require("mcma-core");
const { getAwsV4ResourceManager } = require("mcma-aws");

const environmentVariableProvider = new EnvironmentVariableProvider();
const resourceManager = getAwsV4ResourceManager(environmentVariableProvider);

/**
 * Lambda function handler
 * @param {*} event event
 * @param {*} context context
 */
exports.handler = async (event, context) => {

    console.log(JSON.stringify(event, null, 2), JSON.stringify(context, null, 2));
    console.log('context', context);
    console.log('event', event);
    console.log('event.data', event.data);
    console.log('event.data.awsRekognition', event.data.awsRekognition);
    console.log('event.data.awsRekognition.data', event.data.awsRekognition.data);
    console.log("event.data.awsRekognition['0'].data.awsCelebritiesJobId", event.data.awsRekognition['0'].data.awsCelebritiesJobId);

    // send update notification
    try {
        event.status = "RUNNING";
        // event.parallelProgress = { "detect-celebrities-aws": 80 };
        await resourceManager.sendNotification(event);
    } catch (error) {
        console.warn("Failed to send notification", error);
    }

    // awsCelebrities
    let awsCelebritiesJobId = event.data.awsRekognition['0'].data.awsCelebritiesJobId.find(id => id);
    if (!awsCelebritiesJobId) {
        throw new Error("Failed to obtain awsCelebritiesJobId");
    }
    console.log("awsCelebritiesJobId", awsCelebritiesJobId);
    let awsCelebritiesJob = await resourceManager.resolve(awsCelebritiesJobId);
    console.log("awsCelebritiesJob", awsCelebritiesJob);
    let s3Bucket = awsCelebritiesJob.jobOutput.outputFile.awsS3Bucket;
    let s3Key = awsCelebritiesJob.jobOutput.outputFile.awsS3Key;
    let awsCelebritiesJobS3Object;
    try {
        awsCelebritiesJobS3Object = await S3GetObject({
            Bucket: s3Bucket,
            Key: s3Key,
        });
    } catch (error) {
        throw new Error("Unable to celebrities info file in bucket '" + s3Bucket + "' with key '" + s3Key + "' due to error: " + error.message);
    }
    let celebritiesResult = JSON.parse(awsCelebritiesJobS3Object.Body.toString());
    console.log("celebritiesResult[0]", JSON.stringify(celebritiesResult[0], null, 2));

    // awsEmotions
    let awsEmotionsJobId = event.data.awsRekognition['1'].data.awsEmotionsJobId.find(id => id);
    if (!awsEmotionsJobId) {
        throw new Error("Failed to obtain awsEmotionsJobId");
    }
    console.log("awsEmotionsJobId", awsEmotionsJobId);
    let awsEmotionsJob = await resourceManager.resolve(awsEmotionsJobId);
    console.log("awsEmotionsJob", awsEmotionsJob);
    let awsEmotionsS3Bucket = awsEmotionsJob.jobOutput.outputFile.awsS3Bucket;
    let awsEmotionsS3Key = awsEmotionsJob.jobOutput.outputFile.awsS3Key;
    let awsEmotionsJobS3Object;
    try {
        awsEmotionsJobS3Object = await S3GetObject({
            Bucket: awsEmotionsS3Bucket,
            Key: awsEmotionsS3Key,
        });
    } catch (error) {
        throw new Error("Unable to celebrities info file in bucket '" + awsEmotionsS3Bucket + "' with key '" + awsEmotionsS3Key + "' due to error: " + error.message);
    }
    let emotionsResult = JSON.parse(awsEmotionsJobS3Object.Body.toString());
    console.log("emotionsResult[0]", JSON.stringify(emotionsResult[0], null, 2));

    let celebritiesEmotionsScores = createCelebritiesEmotionsScores(celebritiesResult, emotionsResult);
    console.log("celebritiesEmotionsScores", celebritiesEmotionsScores);

    let bmContent = await resourceManager.resolve(event.input.bmContent);

    if (!bmContent.awsAiMetadata) {
        bmContent.awsAiMetadata = {};
    }
    bmContent.awsAiMetadata.celebritiesEmotions = celebritiesEmotionsScores;

    await resourceManager.update(bmContent);

    try {
        event.status = "RUNNING";
        // event.parallelProgress = { "detect-celebrities-aws": 100 };
        await resourceManager.sendNotification(event);
    } catch (error) {
        console.warn("Failed to send notification", error);
    }

};


function createCelebritiesEmotionsScores(celebrityRecognitionJSON, faceRecognitionJSON) {
    if ((celebrityRecognitionJSON !== undefined) && (faceRecognitionJSON !== undefined)) {
        let celebritiesAndFacesList = flattenFiles(celebrityRecognitionJSON, faceRecognitionJSON);
        let celebritiesList = createCelebritiesList(celebritiesAndFacesList);
        let emotionsList = createFacesList(celebritiesAndFacesList);
        return genScoreCelebrity(celebritiesAndFacesList, celebritiesList, emotionsList);
    }
}

function genScoreCelebrity(celebrities_faces_list, celebritiesList, emotionsList) {
    let celebrityScore = {};
    for (let celebrityItem of celebritiesList) {
        let celebrityEmotions = {};
        for (let emotionItem of emotionsList) {
            celebrityEmotions[emotionItem] = 0;
            celebrityEmotions['counter'] = 0;
        }
        celebrityScore[celebrityItem] = celebrityEmotions;
    }
    for (let nameItem of celebritiesList) {
        for (let celebrities_faces_listItem of celebrities_faces_list) {
            if (nameItem === celebrities_faces_listItem.Celebrity.Name) {
                if ('Emotions' in celebrities_faces_listItem.FaceReko) {
                    celebrityScore[nameItem]['counter'] += 1;
                    let celebritiesEmotions = celebrities_faces_listItem.FaceReko.Emotions;
                    for (let celebritiesEmotionsItem of celebritiesEmotions) {
                        celebrityScore[nameItem][celebritiesEmotionsItem['Type']] += celebritiesEmotionsItem['Confidence']
                    }
                }
            }
        }
    }
    for (let celebrityItem of celebritiesList) {
        let counter = celebrityScore[celebrityItem]['counter'];
        let emotions = celebrityScore[celebrityItem];
        celebrityScore[celebrityItem]['counter'] = counter;
        if (counter === 0) {
            for (let emotionItem in emotions) {
                celebrityScore[celebrityItem][emotionItem] = 0;
            }
        } else {
            for (let emotionItem in emotions) {
                celebrityScore[celebrityItem][emotionItem] = celebrityScore[celebrityItem][emotionItem] / counter;
            }
        }
        celebrityScore[celebrityItem]['counter'] = counter;
    }
    return celebrityScore;
}

function createCelebritiesList(celebritiesAndFacesList) {
    let celebritiesList = new Set();
    for (let celebritiesAndFacesItem of celebritiesAndFacesList) {
        let celebrityName = celebritiesAndFacesItem.Celebrity.Name;
        celebritiesList.add(celebrityName);
    }
    return celebritiesList;
}

function createFacesList(celebritiesAndFacesList) {
    let emotionsList = new Set();
    for (let celebritiesAndFacesItem of celebritiesAndFacesList) {
        let faceReko = celebritiesAndFacesItem.FaceReko;
        if (faceReko.Emotions) {
            let faceRekoEmotions = faceReko.Emotions;
            for (let faceRekoEmotionsItem of faceRekoEmotions) {
                emotionsList.add(faceRekoEmotionsItem.Type);
            }
        }
    }
    return emotionsList;
}

function flattenFiles(celebrityRecognitionJSON, faceRecognitionJSON) {
    let celebritiesList = [];
    let facesList = [];
    for (let celebrity of celebrityRecognitionJSON) {
        // let celebrityTemp = [];
        // celebrityTemp['Timestamp'] = celebrity.Timestamp;
        // celebrityTemp['Celebrity'] = celebrity.Celebrity;
        celebritiesList.push(celebrity);
    }
    for (let face of faceRecognitionJSON) {
        // let faceTemp = [];
        // faceTemp['Timestamp'] = face.Timestamp;
        let faceTempFace = face.Face;
        delete faceTempFace["Pose"];
        delete faceTempFace["Quality"];
        // faceTemp['Face'] = faceTempFace;
        facesList.push(face);
    }
    return mergeFacesAndCelebrities(celebritiesList, facesList);
}

function mergeFacesAndCelebrities(celebritiesList, facesList, threshold = 5) {
    let facesIndexes = [];
    let facesScores = [];
    for (const [celebrityIndex, celebrityValue] of celebritiesList.entries()) {
        let boundingBoxCelebrity = [];
        let celebrityX;
        let celebrityY;
        if (celebrityValue.Celebrity.Face) {
            boundingBoxCelebrity = [
                celebrityValue.Celebrity.Face.BoundingBox.Left,
                celebrityValue.Celebrity.Face.BoundingBox.Top,
                celebrityValue.Celebrity.Face.BoundingBox.Left + celebrityValue.Celebrity.Face.BoundingBox.Width,
                celebrityValue.Celebrity.Face.BoundingBox.Top + celebrityValue.Celebrity.Face.BoundingBox.Height,
            ];
            let celebrityLandmarks = celebrityValue.Celebrity.Face.Landmarks;
            let celebrityLeftEyeCoordinates = getLeftEyeCoordinates(celebrityLandmarks);
            celebrityX = celebrityLeftEyeCoordinates.x;
            celebrityY = celebrityLeftEyeCoordinates.y;
        } else {
            boundingBoxCelebrity = [
                celebrityValue.Celebrity.BoundingBox.Left,
                celebrityValue.Celebrity.BoundingBox.Top,
                celebrityValue.Celebrity.BoundingBox.Left + celebrityValue.Celebrity.BoundingBox.Width,
                celebrityValue.Celebrity.BoundingBox.Top + celebrityValue.Celebrity.BoundingBox.Height,
            ];
        }
        let facesScoresArray = [];
        let facesIndexesArray = [];
        let lefteyeScoreArray = [];
        for (const [faceIndex, faceValue] of facesList.entries()) {
            let boundingBoxFace = [
                faceValue.Face.BoundingBox.Left,
                faceValue.Face.BoundingBox.Top,
                faceValue.Face.BoundingBox.Left + faceValue.Face.BoundingBox.Width,
                faceValue.Face.BoundingBox.Top + faceValue.Face.BoundingBox.Height,
            ];
            let boundingBoxesArea = faceValue.Face.BoundingBox.Width * faceValue.Face.BoundingBox.Height;
            let distance = celebrityValue.Timestamp - faceValue.Timestamp;
            let faceLeftEyeCoordinates = getLeftEyeCoordinates(faceValue.Face.Landmarks);
            let faceX = faceLeftEyeCoordinates.x;
            let faceY = faceLeftEyeCoordinates.y;
            let faceScore = -1;
            let lefteyeScore = 1;
            if (Math.abs(distance) < 1000) {
                if (Math.abs(distance) > 1) {
                    faceScore = getIntersectionRatio(boundingBoxFace, boundingBoxCelebrity, 1e-5);
                } else {
                    faceScore = getIntersectionRatio(boundingBoxFace, boundingBoxCelebrity, 1e-5) * 10;
                }
                if ((celebrityX !== undefined) && (faceX !== undefined) && (celebrityY !== undefined) && (faceY !== undefined)) {
                    lefteyeScore = Math.sqrt((celebrityX - faceX) ** 2 + (celebrityY - faceY) ** 2) / Math.sqrt(boundingBoxesArea);
                }
            }
            if (faceScore > 0) {
                facesScoresArray.push(faceScore);
                lefteyeScoreArray.push(lefteyeScore);
                facesIndexesArray.push(faceIndex);
            }
        }
        if (facesScoresArray.length > 0) {
            let totalScoreArray = [];
            for (const [index, value] of facesScoresArray.entries()) {
                totalScoreArray.push(value / (lefteyeScoreArray[index] + 0.1));
            }
            let celebrityDetected = argMax(totalScoreArray);
            facesIndexes[celebrityIndex] = facesIndexesArray[celebrityDetected];
            facesScores[celebrityIndex] = totalScoreArray[celebrityDetected];
        }
    }
    let celebritiesAndFacesList = [...celebritiesList];
    for (const [index, value] of celebritiesAndFacesList.entries()) {
        if (facesScores[index] > threshold) {
            let emotionsList = facesList[facesIndexes[index]]['Face']['Emotions'];
            let sumRatio = 0;
            for (let emotion of emotionsList) {
                sumRatio = sumRatio + emotion['Confidence'];
            }
            let emotionsListNormalized = [];
            for (let emotion of emotionsList) {
                emotion['Confidence'] = emotion['Confidence'] / (sumRatio * 0.01);
                emotionsListNormalized.push(emotion);
            }
            facesList[facesIndexes[index]]['Face']['Emotions'] = emotionsListNormalized;
            celebritiesAndFacesList[index]['FaceReko'] = facesList[facesIndexes[index]]['Face'];
            celebritiesAndFacesList[index]['FaceReko']['EmotionScore'] = facesScores[index];
        } else {
            celebritiesAndFacesList[index]['FaceReko'] = {};
            celebritiesAndFacesList[index]['FaceReko']['EmotionScore'] = facesScores[index];
        }
    }
    return (celebritiesAndFacesList);
}

function argMax(array) {
    return array.map((x, i) => [x, i]).reduce((r, a) => (a[0] > r[0] ? a : r))[1];
}

function getIntersectionRatio(a, b, epsilon = 1e-5) {
    let x1 = Math.max(a[0], b[0]);
    let y1 = Math.max(a[1], b[1]);
    let x2 = Math.min(a[2], b[2]);
    let y2 = Math.min(a[3], b[3]);
    let width = (x2 - x1);
    let height = (y2 - y1);
    if ((width < 0) || (height < 0)) {
        return 0;
    }
    let areaOverlapped = width * height;
    let areaA = (a[2] - a[0]) * (a[3] - a[1]);
    let areaB = (b[2] - b[0]) * (b[3] - b[1]);
    let areaCombined = Math.min(areaA, areaB);
    return Math.abs(areaOverlapped / (areaCombined + epsilon));
}

function getLeftEyeCoordinates(celebrityLandmarks) {
    let xCoord;
    let yCoord;
    for (let celebrityLandmark of celebrityLandmarks) {
        if (celebrityLandmark.Type === "eyeLeft") {
            xCoord = celebrityLandmark.X;
            yCoord = celebrityLandmark.Y;
        }
    }
    return { x: xCoord, y: yCoord };
}