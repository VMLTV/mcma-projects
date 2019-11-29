//"use strict";
const { Logger, WorkflowJob } = require("mcma-core");
const { WorkerBuilder, WorkerRequest } = require("mcma-worker");
require("mcma-aws");

const { runWorkflow, processNotification } = require("./profiles/run-workflow");

const worker =
    new WorkerBuilder().useAwsJobDefaults()
        .handleJobsOfType(WorkflowJob, x =>
            x.addProfile("ConformWorkflow", runWorkflow)
             .addProfile("AIWorkflow", runWorkflow)
        )
        .handleOperation(processNotification)
        .build();

exports.handler = async (event, context) => {
    try {
        Logger.debug(JSON.stringify(event, null, 2), JSON.stringify(context, null, 2));
        
        await worker.doWork(new WorkerRequest(event));
    } catch (error) {
        Logger.error("Error occurred when handling action '" + event.operationName + "'")
        Logger.exception(error.toString());
    }
}
