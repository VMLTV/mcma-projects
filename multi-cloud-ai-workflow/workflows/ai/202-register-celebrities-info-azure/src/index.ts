import * as AWS from "aws-sdk";
import { Context } from "aws-lambda";
import { EnvironmentVariableProvider, Job, JobBaseProperties, JobParameterBag, McmaException } from "@mcma/core";
import { AuthProvider, getResourceManagerConfig, ResourceManager } from "@mcma/client";
import { AwsCloudWatchLoggerProvider } from "@mcma/aws-logger";
import { awsV4Auth } from "@mcma/aws-client";
import { AwsS3FileLocatorProperties } from "@mcma/aws-s3";
import { BMContent } from "@local/common";

const S3 = new AWS.S3();

const environmentVariableProvider = new EnvironmentVariableProvider();
const resourceManager = new ResourceManager(getResourceManagerConfig(environmentVariableProvider), new AuthProvider().add(awsV4Auth(AWS)));
const loggerProvider = new AwsCloudWatchLoggerProvider("ai-workflow-202-register-celebrities-info-azure", process.env.LogGroupName);

type InputEvent = {
    input: {
        bmContent: string
    },
    data: {
        azureCelebritiesJobId: string[];
    }
} & JobBaseProperties;

/**
 * Lambda function handler
 * @param {*} event event
 * @param {*} context context
 */
export async function handler(event: InputEvent, context: Context) {
    const logger = loggerProvider.get(context.awsRequestId, event.tracker);
    try {
        logger.functionStart(context.awsRequestId);
        logger.debug(event);
        logger.debug(context);

        // send update notification
        try {
            await resourceManager.sendNotification(event);
        } catch (error) {
            logger.warn("Failed to send notification");
            logger.warn(error.toString());
        }

        // get ai job id (first non null entry in array)
        let jobId = event.data.azureCelebritiesJobId.find(id => id);
        if (!jobId) {
            throw new McmaException("Failed to obtain azureCelebritiesJobId");
        }
        logger.info("[azureCelebritiesJobId]:", jobId);

        // get result of ai job
        let job = await resourceManager.get<Job>(jobId);
        let jobOutput = new JobParameterBag(job.jobOutput);

        // get media info
        let outputFile = jobOutput.get<AwsS3FileLocatorProperties>("outputFile");
        let s3Bucket = outputFile.awsS3Bucket;
        let s3Key = outputFile.awsS3Key;
        let s3Object;
        try {
            s3Object = await S3.getObject({
                Bucket: s3Bucket,
                Key: s3Key
            }).promise();
        } catch (error) {
            throw new McmaException("Unable to find data file in bucket '" + s3Bucket + "' with key '" + s3Key + "' due to error: " + error.message);
        }

        let azureResult = JSON.parse(s3Object.Body.toString());
        logger.info("AzureResult: " + JSON.stringify(azureResult, null, 2));

        let bmContent = await resourceManager.get<BMContent>(event.input.bmContent);

        let azureAiMetadata = bmContent.azureAiMetadata || {};
        azureAiMetadata = azureResult;
        bmContent.azureAiMetadata = azureAiMetadata;

        let azureTranscription = "";
        if (azureAiMetadata.videos) {
            for (const video of azureAiMetadata.videos) {
                if (video.insights) {
                    if (video.insights.transcript) {

                        for (const transcript of video.insights.transcript) {
                            if (transcript.text) {
                                azureTranscription += transcript.text + " ";
                            }
                        }
                        azureTranscription.trim();
                    }

                }
            }
        }

        if (!bmContent.azureAiMetadata.azureTranscription) {
            bmContent.azureAiMetadata.azureTranscription = {};
        }

        bmContent.azureAiMetadata.azureTranscription.transcription = azureTranscription;

        await resourceManager.update(bmContent);
    } catch (error) {
        logger.error("Failed to register celebrities info");
        logger.error(error.toString());
        throw new McmaException("Failed to register celebrities info", error);
    } finally {
        logger.functionEnd(context.awsRequestId);
        await loggerProvider.flush();
    }
}
