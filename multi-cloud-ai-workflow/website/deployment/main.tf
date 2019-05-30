#########################
# Provider registration 
#########################

provider "aws" {
  version = "~> 2.7"

  access_key = "${var.aws_access_key}"
  secret_key = "${var.aws_secret_key}"
  region     = "${var.aws_region}"
}

#########################
# Website bucket
#########################

data "template_file" "s3_public_read_policy_website" {
  template = "${file("../../deployment/policies/s3-public-read.json")}"

  vars = {
    bucket_name = "${var.website_bucket}"
  }
}

resource "aws_s3_bucket" "website" {
  bucket = "${var.website_bucket}"
  acl    = "public-read"
  policy = "${data.template_file.s3_public_read_policy_website.rendered}"
  force_destroy = true

  website {
    index_document = "index.html"
  }
}

output "upload_bucket" {
  value = "${var.upload_bucket}"
}

output "website_bucket" {
  value = "${var.website_bucket}"
}

output "website_url" {
  value = "https://s3${var.aws_region != "us-east-1" ? "-" : ""}${var.aws_region != "us-east-1" ? var.aws_region : ""}.amazonaws.com/${var.website_bucket}/index.html"
}

#########################
# Cognito
#########################

resource "aws_cognito_user_pool" "user_pool" {
  name = "${var.global_prefix}_user_pool"
}

resource "aws_cognito_user_pool_client" "client" {
  name            = "${var.global_prefix}_user_pool_client"
  user_pool_id    = "${aws_cognito_user_pool.user_pool.id}"
  generate_secret = false
}

resource "aws_cognito_identity_pool" "identity_pool" {
  identity_pool_name               = "${replace("${replace("${var.global_prefix}", "/[^a-zA-Z0-9 ]/", " ")}", "/[ ]+/", " ")}"
  allow_unauthenticated_identities = false

  cognito_identity_providers {
    client_id               = "${aws_cognito_user_pool_client.client.id}"
    provider_name           = "${aws_cognito_user_pool.user_pool.endpoint}"
    server_side_token_check = false
  }
}

resource "aws_iam_role" "authenticated" {
  name = "${var.global_prefix}-${var.aws_region}-cognito-authenticated"

  assume_role_policy = <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "cognito-identity.amazonaws.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "cognito-identity.amazonaws.com:aud": "${aws_cognito_identity_pool.identity_pool.id}"
        },
        "ForAnyValue:StringLike": {
          "cognito-identity.amazonaws.com:amr": "authenticated"
        }
      }
    }
  ]
}
EOF
}

resource "aws_iam_role_policy" "authenticated" {
  name = "${var.global_prefix}-${var.aws_region}-authenticated-policy"
  role = "${aws_iam_role.authenticated.id}"

  policy = <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "mobileanalytics:PutEvents",
        "cognito-sync:*",
        "cognito-identity:*"
      ],
      "Resource": [
        "*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": "S3:*",
      "Resource": "*"
    },
    {
        "Effect": "Allow",
        "Action": "execute-api:Invoke",
        "Resource": "arn:aws:execute-api:*:*:*"
    }
  ]
}
EOF
}

resource "aws_iam_role" "unauthenticated" {
  name = "${var.global_prefix}-${var.aws_region}-cognito-unauthenticated"

  assume_role_policy = <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "cognito-identity.amazonaws.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "cognito-identity.amazonaws.com:aud": "${aws_cognito_identity_pool.identity_pool.id}"
        },
        "ForAnyValue:StringLike": {
          "cognito-identity.amazonaws.com:amr": "unauthenticated"
        }
      }
    }
  ]
}
EOF
}

resource "aws_iam_role_policy" "unauthenticated" {
  name = "${var.global_prefix}-${var.aws_region}-unauthenticated-policy"
  role = "${aws_iam_role.unauthenticated.id}"

  policy = <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "mobileanalytics:PutEvents",
        "cognito-sync:*"
      ],
      "Resource": [
        "*"
      ]
    }
  ]
}
EOF
}

resource "aws_cognito_identity_pool_roles_attachment" "main" {
  identity_pool_id = "${aws_cognito_identity_pool.identity_pool.id}"

  roles = {
    "authenticated"   = "${aws_iam_role.authenticated.arn}"
    "unauthenticated" = "${aws_iam_role.unauthenticated.arn}"
  }
}

output "aws_region" {
  value = "${var.aws_region}"
}

output "services_url" {
  value = "${var.services_url}"
}

output "services_auth_type" {
  value = "${var.services_auth_type}"
}

output "services_auth_context" {
  value = "${var.services_auth_context}"
}

output "cognito_user_pool_id" {
  value = "${aws_cognito_user_pool.user_pool.id}"
}

output "cognito_user_pool_client_id" {
  value = "${aws_cognito_user_pool_client.client.id}"
}

output "cognito_identity_pool_id" {
  value = "${aws_cognito_identity_pool.identity_pool.id}"
}
