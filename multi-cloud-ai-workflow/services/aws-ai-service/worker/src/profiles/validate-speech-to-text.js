const util = require("util");
const uuidv4 = require("uuid/v4");

const http = require('http');

const AWS = require("aws-sdk");
const S3 = new AWS.S3();
const S3GetObject = util.promisify(S3.getObject.bind(S3));
const S3PutObject = util.promisify(S3.putObject.bind(S3));

const fs = require("fs");
const fsWriteFile = util.promisify(fs.writeFile);
const fsAppendFile = util.promisify(fs.appendFile);
const fsReadFile = util.promisify(fs.readFile);
const fsUnlink = util.promisify(fs.unlink);

const RpcClient = require('node-json-rpc2').Client;
const axios = require('axios');

const { Logger, Locator } = require("mcma-core");

async function validateSpeechToText(workerJobHelper) {
    const jobInput = workerJobHelper.getJobInput();
    const hypothesis = jobInput.inputFile;
    const outputLocation = jobInput.outputLocation;
    const jobAssignmentId = workerJobHelper.getJobAssignmentId();

    Logger.debug("#################################");
    Logger.debug("validate-speech-to-text.js");
    Logger.debug("#################################");

    Logger.debug("31. STT benchmarking evaluating the quality of the speech to text service");

    Logger.debug("31.1 get STT output file -> hypothesis from job creation parameters");
    // the content to be tested is called "hypothesis" in respect to the terminology used in STT benchmarking 
    const s3Bucket_hypothesis = hypothesis.awsS3Bucket;
    const s3Key_hypothesis = hypothesis.awsS3Key;
    let s3Object_hypothesis;
    try {
        s3Object_hypothesis = await S3GetObject({
            Bucket: s3Bucket_hypothesis,
            Key: s3Key_hypothesis,
        });
    } catch (error) {
        throw new Error("Unable to read file in bucket '" + s3Bucket_hypothesis + "' with key '" + s3Key_hypothesis + "' due to error: " + error.message);
    }

    Logger.debug("31.2 extract hypothesis text to be evaluated");
    const hypothesisText = s3Object_hypothesis.Body.toString();
    console.log(hypothesisText);

    Logger.debug("31.3 get reference file stored in tempBucket/temp provided from step 31 as input parameter in job call");
    const s3Key_reference = "temp/stt_output_clean.txt";
    let s3Object_reference;
    try {
        s3Object_reference = await S3GetObject({
            Bucket: s3Bucket_hypothesis,
            Key: s3Key_reference,
        });
    } catch (error) {
        throw new Error("Unable to read file in bucket '" + s3Bucket_hypothesis + "' with key '" + s3Key_reference + "' due to error: " + error.message);
    }

    Logger.debug("31.4 extract reference text against which hypothesisText is to be compared");
    const referenceText = JSON.parse(s3Object_reference.Body.toString());
    console.log(referenceText.results.transcripts[0].transcript);

    Logger.debug("31.4 initialse and call sttbenchmarking service from public url using node-json-rpc2 API")
    // The URL is generated by AWS ECS when initializing the service and task from the sttBenchmarking docker image");
    // Only worddiffs is used for visualisation of the results but other options are available such as the word error rate 
    let client = new RpcClient({
        protocol:'http',//Optional. Will be http by default
        host:'52.30.8.180',
        path:'/api',
        port:'8080',
        method:'POST'//Optional. POST by default
    });    
    let params={};
    params.ref = "\""+referenceText.results.transcripts[0].transcript+"\"";
    params.hyp = "\""+hypothesisText+"\"";
    params.dialect = "html";
    // worddiffs
    let request_wd = {};
    request_wd.jsonrpc = "2.0";
    request_wd.id = "79idqltpu8";
    request_wd.params = params;
    request_wd.method = "metrics.worddiffs";
    console.log(request_wd);

    const clientCall = util.promisify(client.call.bind(client));

    Logger.debug("31.5 Visualise worddiffs results")
    const result = await clientCall(request_wd);
    console.log(result);

    Logger.debug("31.6 Save worddiffs results to worddiffs.txt file on TempBucket/AIResults")
    const s3Params = {
        Bucket: outputLocation.awsS3Bucket,
        Key: (outputLocation.awsS3KeyPrefix ? outputLocation.awsS3KeyPrefix : "") + "sttbenchmarking/worddiffs.txt",
        Body: JSON.stringify(result) 
    }
    S3PutObject(s3Params);

    Logger.debug("31.7 Updating jobAssignment with job output")
    workerJobHelper.getJobOutput().outputFile = new Locator({
        awsS3Bucket: s3Params.Bucket,
        awsS3Key: s3Params.Key
    });
    await workerJobHelper.complete();

}

validateSpeechToText.profileName = "ValidateSpeechToText";

module.exports = {
    validateSpeechToText
};