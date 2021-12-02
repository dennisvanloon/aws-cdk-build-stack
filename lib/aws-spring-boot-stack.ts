import * as cdk from "@aws-cdk/core";
import * as s3 from "@aws-cdk/aws-s3";
import * as codeartifact from "@aws-cdk/aws-codeartifact";
import * as codecommit from "@aws-cdk/aws-codecommit";
import * as codepipeline from "@aws-cdk/aws-codepipeline";
import * as cpactions from "@aws-cdk/aws-codepipeline-actions";
import * as codebuild from "@aws-cdk/aws-codebuild";
import * as iam from "@aws-cdk/aws-iam";
import { ComputeType, LinuxBuildImage } from "@aws-cdk/aws-codebuild";
import { PolicyDocument, ServicePrincipal } from "@aws-cdk/aws-iam";

export class AwsSpringBootStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    const artifactBucket = new s3.Bucket(this, "ArtifactBucket", {
      bucketName: cdk.Stack.of(this).stackName.toLowerCase() + "-artifactbucket",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const codeArtifactDomain = new codeartifact.CfnDomain(this, "CodeArtifactDomain", {
      domainName: cdk.Stack.of(this).stackName.toLowerCase() + "-domain",
    });

    const codeArtifactRepository = new codeartifact.CfnRepository(this, "CodeArtifactRepository", {
      domainName: codeArtifactDomain.domainName,
      repositoryName: cdk.Stack.of(this).stackName.toLowerCase() + "-repository",
    });

    const repository = new codecommit.Repository(this, "Repository", {
      repositoryName: cdk.Stack.of(this).stackName.toLowerCase() + "-repository",
      description: "Repository for my spring boot code.",
    });

    const codeBuildServiceRole = new iam.Role(this, "codeBuildServiceRole", {
      assumedBy: new ServicePrincipal("codebuild.amazonaws.com"),
      inlinePolicies: {
        codeBuildPolicy: new PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              sid: "CloudWatchLogsPolicy",
              effect: iam.Effect.ALLOW,
              actions: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
              resources: ["*"],
            }),
            new iam.PolicyStatement({
              sid: "CodeCommitPolicy",
              effect: iam.Effect.ALLOW,
              actions: ["codecommit:GitPull"],
              resources: [repository.repositoryArn],
            }),
            new iam.PolicyStatement({
              sid: "S3GetObjectPolicy",
              effect: iam.Effect.ALLOW,
              actions: ["s3:GetObject", "s3:GetObjectVersion"],
              resources: [artifactBucket.bucketArn + "/*"],
            }),
            new iam.PolicyStatement({
              sid: "S3PutObjectPolicy",
              effect: iam.Effect.ALLOW,
              actions: ["s3:PutObject"],
              resources: [artifactBucket.bucketArn + "/*"],
            }),
            new iam.PolicyStatement({
              sid: "BearerTokenPolicy",
              effect: iam.Effect.ALLOW,
              actions: ["sts:GetServiceBearerToken"],
              resources: ["*"],
              conditions: {
                StringEquals: { "sts:AWSServiceName": "codeartifact.amazonaws.com" },
              },
            }),
            new iam.PolicyStatement({
              sid: "CodeArtifactPolicy",
              effect: iam.Effect.ALLOW,
              actions: ["codeartifact:GetAuthorizationToken"],
              resources: [codeArtifactDomain.attrArn],
            }),
            new iam.PolicyStatement({
              sid: "CodeArtifactPackage",
              effect: iam.Effect.ALLOW,
              actions: [
                "codeartifact:PublishPackageVersion",
                "codeartifact:PutPackageMetadata",
                "codeartifact:ReadFromRepository",
              ],
              resources: [
                "arn:aws:codeartifact:" +
                  props.env?.region +
                  ":" +
                  props.env?.account +
                  ":package/" +
                  codeArtifactDomain.attrName +
                  "/" +
                  codeArtifactRepository.attrName +
                  "/*",
              ],
            }),
            new iam.PolicyStatement({
              sid: "CodeArtifactRepository",
              effect: iam.Effect.ALLOW,
              actions: ["codeartifact:ReadFromRepository", "codeartifact:GetRepositoryEndpoint"],
              resources: [
                "arn:aws:codeartifact:" +
                  props.env?.region +
                  ":" +
                  props.env?.account +
                  ":repository/" +
                  codeArtifactDomain.attrName +
                  "/" +
                  codeArtifactRepository.attrName,
              ],
            }),
          ],
        }),
      },
    });

    const codeBuildProject = new codebuild.PipelineProject(this, "CodeBuildProject", {
      projectName: cdk.Stack.of(this).stackName.toLowerCase() + "-codebuild",
      environment: {
        buildImage: LinuxBuildImage.AMAZON_LINUX_2_3,
        computeType: ComputeType.SMALL,
        environmentVariables: {
          CODEARTIFACT_DOMAIN: { value: codeArtifactDomain.domainName },
          CODEARTIFACT_REPO: { value: repository.repositoryName },
        },
      },
      role: codeBuildServiceRole.withoutPolicyUpdates(),
      buildSpec: codebuild.BuildSpec.fromSourceFilename("buildspec.yaml"),
    });

    const codePipelineServiceRole = new iam.Role(this, "codePipelineServiceRole", {
      assumedBy: new ServicePrincipal("codepipeline.amazonaws.com"),
      inlinePolicies: {
        codePipelinePolicy: new PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["s3:GetObject", "s3:GetObjectVersion", "s3:GetBucketVersioning"],
              resources: [artifactBucket.bucketArn + "/*"],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["s3:PutObject"],
              resources: [artifactBucket.bucketArn + "/*"],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "codecommit:GetBranch",
                "codecommit:GetCommit",
                "codecommit:UploadArchive",
                "codecommit:GetUploadArchiveStatus",
                "codecommit:CancelUploadArchive",
              ],
              resources: [repository.repositoryArn],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["codebuild:StartBuild", "codebuild:BatchGetBuilds"],
              resources: [codeBuildProject.projectArn],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["iam:PassRole"],
              resources: ["*"],
            }),
          ],
        }),
      },
    });

    const sourceOutput = new codepipeline.Artifact("SourceBundle");
    const sourceAction = new cpactions.CodeCommitSourceAction({
      actionName: "Source",
      repository: repository,
      branch: "master",
      output: sourceOutput,
      runOrder: 1,
    });
    const sourceStage = {
      stageName: "Source",
      actions: [sourceAction],
    };

    const codeBuildAction = new cpactions.CodeBuildAction({
      project: codeBuildProject,
      actionName: "CodeBuild",
      input: sourceOutput,
      runOrder: 1,
    });
    const codeBuildStage = {
      stageName: "CodeBuild",
      actions: [codeBuildAction],
    };

    const codePipeline = new codepipeline.Pipeline(this, "CodePipeline", {
      artifactBucket: artifactBucket,
      role: codePipelineServiceRole,
      stages: [sourceStage, codeBuildStage],
    });

    new cdk.CfnOutput(this, "CodePipelineArtifactBucket", { value: artifactBucket.bucketArn });
    new cdk.CfnOutput(this, "CodeRepositoryHttpCloneUrl", { value: repository.repositoryCloneUrlHttp });
    new cdk.CfnOutput(this, "CodeRepositorySshCloneUrl", { value: repository.repositoryCloneUrlSsh });
  }
}
