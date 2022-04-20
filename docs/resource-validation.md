# Validating Resources

Monokle automatically validates all resources of the corresponding Kubernetes 1.22.1 schemas. In the Navigator, a resource which is not validated is shown with a red error icon. A resource with a broken link is shown with a yellow triangle.

![Resource Validation](img/link-syntax-errors-image-1-1.5.0.png)

## **Inspecting Link and Syntax Validation Errors**

You will see the number of both link and syntax validation errors in resources at the top of the Navigator:

![Link and Syntax Errors](img/navigator-link-and-syntax-errors-header-1.6.0.png)

Click on the yellow triangle to see a list of the broken links in the current resources:

![Link Errors](img/navigator-broken-links-list-1.6.0.png)

Click on the red circle to see a list of syntax errors in the current resources:

![Syntax Errors](img/navigator-syntax-errors-list-1.6.0.png)

Clicking on any item in the broken link or syntax error list will locate the file where the error exits in the Navigator and open the source in the Editor.

This same functionality is available when the error icons are next to the file names in the Navigator:

![Link and Syntax Icons](img/navigator-link-syntax-errors-1.6.0.png)

Hover on the error icon to check the error details and see the corresponding line in the Editor:

![Resource Error Popup](img/error-details-popup-1.5.0.png)

## **Inspecting Policy Errors**

Monokle now integrates with the Open Policy Agent and is able to use Rego policies to validate your resources. This means that validation now goes beyond syntax validation and also ensures that semantics are correct. For example, you can enable a policy that ensures that images no longer use the `latest` tag.

Let's have a look at how you would configure and remediate violations.

When you look at the left sidebar, you will notice that a new icon is available for resource validation. Clicking on the icon will open a drawer:

![Open validation drawer](img/missing.png)

This is the new home for all modules related to validation. Continue by clicking on the Open Policy Agent integration and you will see a set of rules:

![Open OPA drawer](img/missing.png)

Here you can familiarize yourself with the rules that are available. We recommend enabling all of them and afterwards disabling those that generate too much noice for your use cases.

Great! Policy validation is now enabled. Policy errors have the same behavior as syntax errors. This means that you will see a red error icon appear whenever a violation is detected.

![Policy error navigator](img/missing.png)

After opening the resource in your editor, you will notice that the error is also marked in gutter and highlighted. Hovering the error will show you help on how to remediate the violation. Use this information to directly edit your resource and the errors will dissapear in real-time.

![Policy error editor](img/missing.png)

### **Policy FAQ**

**Can I extend the policies?**

Only a set of preconfigured rules is currently available. In the future, you can expect plugins where you can plug-and-play additional rules from the internet or create one yourself to ensure internal policy compliance.

**How does it work?**

Under the hood, Rego policies are compiled to web assembly. Monokle uses [the opa-wasm NPM module][npm-opa-wasm] to load the policy and evaluate your resources in real-time.

[npm-opa-wasm]: https://www.npmjs.com/package/@open-policy-agent/opa-wasm
