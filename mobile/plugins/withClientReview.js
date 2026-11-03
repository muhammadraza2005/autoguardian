const { withAppBuildGradle, CodeGenerator } = require('expo/config-plugins');

// Native release libraries open the embedded bundle without a Metro server or
// Expo development launcher. The review application embeds a production release
// JS bundle to avoid crashing on missing development native modules (DevSettings/HMRClient).
module.exports = function withClientReview(config) {
  return withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language !== 'groovy') {
      throw new Error('The client review plugin requires a Groovy app build.gradle.');
    }
    if (!process.env.AUTOGUARDIAN_REVIEW_NUMBER) {
      mod.modResults.contents = CodeGenerator.removeGeneratedContents(
        mod.modResults.contents,
        'autoguardian-client-review',
      ) ?? mod.modResults.contents;
      return mod;
    }
    mod.modResults.contents = CodeGenerator.mergeContents({
      src: mod.modResults.contents,
      tag: 'autoguardian-client-review',
      anchor: /apply plugin: "com.facebook.react"/,
      offset: 1,
      comment: '//',
      newSrc: `
// AutoGuardian client review configuration.
// Embed stable production release JS and assets for standalone use.
gradle.projectsEvaluated {
    tasks.withType(com.facebook.react.tasks.BundleHermesCTask).configureEach {
        devEnabled.set(false)
        minifyEnabled.set(false)
        doFirst {
            println("AutoGuardian client review: embedding production release JS and assets for standalone use.")
        }
    }
}
`,
    }).contents;
    return mod;
  });
};
