const util = require("util");
const AWS = require("aws-sdk");

const S3 = new AWS.S3();
const S3GetBucketLocation = util.promisify(S3.getBucketLocation.bind(S3));
const S3CopyObject = util.promisify(S3.copyObject.bind(S3));
const S3DeleteObject = util.promisify(S3.deleteObject.bind(S3));

const TranscribeService = new AWS.TranscribeService();
const TranscribeServiceStartTranscriptionJob = util.promisify(TranscribeService.startTranscriptionJob.bind(TranscribeService));

const { Logger, JobAssignment, Locator, AIJob } = require("mcma-core");
const { WorkerJobHelper } = require("mcma-worker");
const { DynamoDbTableProvider, getAwsV4ResourceManager } = require("mcma-aws");

async function transcribeAudio(workerJobHelper) {
    const inputFile = workerJobHelper.getJobInput().inputFile;
    const jobAssignmentId = workerJobHelper.getJobAssignmentId();

    Logger.debug("2. Speech to text transcription service");

    Logger.debug("2.1 Obtain input media file URL");
    let mediaFileUrl;
    if (inputFile.httpEndpoint) {
        mediaFileUrl = inputFile.httpEndpoint;
    } else {
        const data = await S3GetBucketLocation({ Bucket: inputFile.awsS3Bucket });
        Logger.debug(JSON.stringify(data, null, 2));
        const s3SubDomain = data.LocationConstraint && data.LocationConstraint.length > 0 ? `s3-${data.LocationConstraint}` : "s3";
        mediaFileUrl = "https://" + s3SubDomain + ".amazonaws.com/" + inputFile.awsS3Bucket + "/" + inputFile.awsS3Key;
    }

    Logger.debug("2.2 identify media format");
    let mediaFormat;
    if (mediaFileUrl.toLowerCase().endsWith("mp3")) {
        mediaFormat = "mp3";
    } else if (mediaFileUrl.toLowerCase().endsWith("mp4")) {
        mediaFormat = "mp4";
    } else if (mediaFileUrl.toLowerCase().endsWith("wav")) {
        mediaFormat = "wav";
    } else if (mediaFileUrl.toLowerCase().endsWith("flac")) {
        mediaFormat = "flac";
    } else {
        throw new Error("Unable to determine Media Format from input file '" + mediaFileUrl + "'");
    }

    Logger.debug("2.3 initialise and call transcription service");
    const params = {
        TranscriptionJobName: "TranscriptionJob-" + jobAssignmentId.substring(jobAssignmentId.lastIndexOf("/") + 1),
        LanguageCode: "en-US",
        Media: {
            MediaFileUri: mediaFileUrl
        },
        MediaFormat: mediaFormat,
//        Settings: {
//            ChannelIdentification:true
//        },
        OutputBucketName: workerJobHelper.getRequest().getRequiredContextVariable("ServiceOutputBucket")
    }

    Logger.debug("2.4 call speech to text service");
    const data = await TranscribeServiceStartTranscriptionJob(params);

    Logger.debug("2.5 visualise service results with path to STT results in service local reporsitory");
    console.log(JSON.stringify(data, null, 2));

    Logger.debug("2.6. TranscriptionJobName used in s3-trigger");
    console.log("See regex for transcriptionJob in aws-ai-service/se-trigger/src/index.js")
    console.log(params.TranscriptionJobName);

}

const dynamoDbTableProvider = new DynamoDbTableProvider(JobAssignment);

const processTranscribeJobResult = async (request) => {
    const workerJobHelper = new WorkerJobHelper(
        AIJob,
        dynamoDbTableProvider.table(request.tableName()),
        getAwsV4ResourceManager(request),
        request,
        request.input.jobAssignmentId
    );
    
    let jobAssignmentId = request.input.jobAssignmentId;

    try {
        await workerJobHelper.initialize();

        Logger.debug("2.7. Retrieve job inputParameters");
        let jobInput = workerJobHelper.getJobInput();

        Logger.debug("2.8. Copy transcribe output file to output location");
        let copySource = encodeURI(request.input.outputFile.awsS3Bucket + "/" + request.input.outputFile.awsS3Key);
        let s3Bucket = jobInput.outputLocation.awsS3Bucket;
        let s3Key = (jobInput.outputLocation.awsS3KeyPrefix ? jobInput.outputLocation.awsS3KeyPrefix : "") + request.input.outputFile.awsS3Key;
        try {
            await S3CopyObject({
                CopySource: copySource,
                Bucket: s3Bucket,
                Key: s3Key,
            });
        } catch (error) {
            throw new Error("Unable to copy output file to bucket '" + s3Bucket + "' with key '" + s3Key + "' due to error: " + error.message);
        }

        Logger.debug("2.9. updating JobAssignment with jobOutput");
        workerJobHelper.getJobOutput().outputFile = new Locator({
            awsS3Bucket: s3Bucket,
            awsS3Key: s3Key
        });
        
        await workerJobHelper.complete();

    } catch (error) {
        Logger.exception(error);
        try {
            await workerJobHelper.fail(error.message);
        } catch (error) {
            Logger.exception(error);
        }
    }

    Logger.debug("2.10. Cleanup: Deleting original output file from service");
    try {
        await S3DeleteObject({
            Bucket: request.input.outputFile.awsS3Bucket,
            Key: request.input.outputFile.awsS3Key,
        });
    } catch (error) {
        console.warn("Failed to cleanup transcribe output file");
    }
}

transcribeAudio.profileName = "AWSTranscribeAudio";

module.exports = {
    transcribeAudio,
    processTranscribeJobResult
};