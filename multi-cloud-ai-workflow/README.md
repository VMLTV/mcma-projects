# multi-cloud-ai-workflow

This example workflow demonstrates how you can leverage AI technologies from multiple cloud vendors in a single media workflow

## Requirements for running the example
* Node.js v10.16.3 installed and accessible in PATH. Recommended is to use a node version manager, which allows you to quickly switch between node versions (see more info at [nvm-windows](https://github.com/coreybutler/nvm-windows) for windows support or [nvm](https://github.com/creationix/nvm) for Mac OS and Linux support)
* Terraform v0.12.19 installed and available in PATH. See the [Terraform website](https://www.terraform.io/)
* Java JRE or JDK 1.8 or higher to run Gradle build and deploy scripts
* AWS account
* Azure video indexer account, a free account can be used for testing. Follow these instructions: https://docs.microsoft.com/en-us/azure/cognitive-services/video-indexer/video-indexer-use-apis

## Setup procedure
1. Clone this repository to your local harddrive 
* On Mac OS:
  A: Open Terminal
  B: Make sure you have XCode: use "xcode-select -p" and the reply should be /Library/Developer/CommandLineTools. If not, use "xcode-select --install" 
  C: Paste git clone https://github.com/ebu/mcma-projects/ and press enter. The default download location if in the home directory of the cyurrent user. You can also search the finder for mcma-projects to find it.
2. Navigate to the `multi-cloud-ai-workflow` folder.
* On Mac: sudo npm install -g typescript@3.7.2 to install a needed part of the npm
3. Create file named `gradle.properties`
4. Add the following information to the created file and update the parameter values reflecting your AWS account and Azure account 
```
# Mandatory settings

environmentName=com.your-domain.mcma
environmentType=dev

#Add your personal credentials between the < > 
awsAccountId=<YOUR_AWS_ACCOUNT_ID>
awsAccessKey=<YOUR_AWS_ACCESS_KEY>
awsSecretKey=<YOUR_AWS_SECRET_KEY>
awsRegion=<YOUR_AWS_REGION>
#select the AWS region close to you to limit latency or select a region with a better pricing. Use the shortcode f.e. <eu-west-1>

# Optional settings, though without configuration some features may not work

AzureLocation=<YOUR AZURE REGION - USE "trial" FOR TESTING>
AzureAccountID=<YOUR AZURE Video Indexer Account ID> 
AzureSubscriptionKey=<YOUR AZURE SUBSCRIPTION KEY>
AzureApiUrl=<AZURE VIDEO API END[POINT DEFAULT IS: https://api.videoindexer.ai>
```

5. Save the file.
6. Open command line in `multi-cloud-ai-workflow` folder.
MAC OS: Drag and drop the gradlew UNIX executable and press enter to install the gradlew
7. Execute `gradlew deploy` and let it run. This can take a few minutes.
* MAC OS: go to your folder cd /Users/xxxxxxx/mcma-projects/multi-cloud-ai-workflow/
Copy paste in terminal + enter:  sudo ./gradlew deploy 
8. If no errors have occurred until now you have successfully setup the infrastructure in your AWS cloud. Go to https://aws.amazon.com/console/ and sign in to see your cloud infrastructure. In case you do have errors it may be that your environmentName is either too long or not unique enough to guarantee unique names for your cloud resources e.g. bucket names.
