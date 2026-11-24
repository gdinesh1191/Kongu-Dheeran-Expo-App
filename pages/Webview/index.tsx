import { scaleFont } from "@/constants/ScaleFont";
import { postUserDetails } from "@/hooks/api/postUserDetails";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { useNavigation } from "@react-navigation/native";
import { Directory, File, Paths } from "expo-file-system";
import * as ExpoPrint from "expo-print";
import * as SMS from "expo-sms";
import * as StoreReview from "expo-store-review";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  BackHandler,
  Linking,
  Modal,
  PermissionsAndroid,
  Platform,
  Text,
  ToastAndroid,
  View,
} from "react-native";
import DeviceInfo from "react-native-device-info";
import Share from "react-native-share";
import { WebView } from "react-native-webview";
import { styles } from "./style";

// Razorpay Checkout detects Android WebView from the user agent
// ("; wv)" token and "Version/4.0") and hides UPI apps/intent in that case.
// Present the WebView as a regular Chrome browser so UPI options are shown.
const browserLikeUserAgent = (ua?: string) => {
  console.log("ua", ua);
  const fallback =
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
  if (!ua) return fallback;
  return ua
    .replace("; wv)", ")")
    .replace(/\s?Version\/\d+\.\d+/i, "")
    .trim();
};

export default function Webview() {
  const webViewRef = useRef<any>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const lastBackPressRef = useRef(0);
  const navigation = useNavigation<any>();
  const [AndroidID, setAndroidID] = useState("");
  const [subscriptionID, setsubscriptionID] = useState<string | null>(null);
  const canGoBackRef = useRef(false);

  const [appOpenCount, setAppOpenCount] = useState(0);
  const lastReviewRequest = useRef<number>(0);
  const [appState, setAppState] = useState(AppState.currentState);
  const [deviceInfo, setDeviceInfo] = useState<any>(null);
  const [browserUserAgent, setBrowserUserAgent] = useState<string | null>(null);
  const hasPostedRef = useRef(false);
  const [messages, setmessages] = useState([]);
  const [messagesSent, setMessagesSent] = useState<any[]>([]);
  const [currentMessageIndex, setCurrentMessageIndex] = useState(0);
  const [appStateListenerActive, setAppStateListenerActive] = useState(false);
  const [DownloadmodalVisible, setDownloadModalVisible] = useState(false);
  const [PrintmodalVisible, setPrintModalVisible] = useState(false);

  const checkNetworkStatus = () => {
    NetInfo.fetch().then((state) => {
      if (!state.isConnected) {
        navigation.navigate("Network"); // Navigate to network error page
      }
    });
  };

  useEffect(() => {
    checkPermissions();
    getId();
    getAllDeviceInfo();
  }, []);

  useEffect(() => {
    if (messages.length > 0) {
      sendNextMessage();
    }
  }, [messages]);

  useEffect(() => {
    if (subscriptionID && deviceInfo?.subscriptionID !== subscriptionID) {
      setDeviceInfo((prev: any) => ({ ...prev, subscriptionID }));
    }
  }, [subscriptionID, deviceInfo]);

  useEffect(() => {
    if (deviceInfo?.subscriptionID && !hasPostedRef.current) {
      hasPostedRef.current = true;
      postDeviceInfo();
    }
  }, [deviceInfo]);

  const checkPermissions = async () => {
    const isAndroid10OrAbove =
      Platform.OS === "android" && Number(Platform.Version) > 31;

    if (isAndroid10OrAbove) {
      const granted = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      );
      if (!granted) {
        navigation.navigate("PermissionScreen");
      }
    }
  };

  const postDeviceInfo = async () => {
    try {
      const details = await postUserDetails(deviceInfo);
      console.log("details", details);
    } catch (error) {
      console.log(error);
    }
  };

  const getAllDeviceInfo = async () => {
    try {
      const [
        androidApiLevel,
        androidID,
        brand,
        systemName,
        systemVersion,
        applicationBuildVersion,
        operatorName,
        device,
        deviceID,
        deviceName,
        fontScale,
        hardware,
        ipAddress,
        macAddress,
        manufacturer,
        modal,
        productName,
        applicationVersion,
        userAgent,
      ] = await Promise.all([
        DeviceInfo.getApiLevel(),
        DeviceInfo.getAndroidId(),
        DeviceInfo.getBrand(),
        DeviceInfo.getSystemName(),
        DeviceInfo.getSystemVersion(),
        DeviceInfo.getBuildNumber(),
        DeviceInfo.getCarrier(),
        DeviceInfo.getDevice(),
        DeviceInfo.getDeviceId(),
        DeviceInfo.getDeviceName(),
        DeviceInfo.getFontScale(),
        DeviceInfo.getHardware(),
        DeviceInfo.getIpAddress(),
        DeviceInfo.getMacAddress(),
        DeviceInfo.getManufacturer(),
        DeviceInfo.getModel(),
        DeviceInfo.getProduct(),
        DeviceInfo.getVersion(),
        DeviceInfo.getUserAgent(),
      ]);
      const deviceInfo = {
        androidApiLevel,
        androidID,
        brand,
        systemName,
        systemVersion,
        applicationBuildVersion,
        operatorName,
        device,
        deviceID,
        deviceName,
        fontScale,
        hardware,
        ipAddress,
        macAddress,
        manufacturer,
        modal,
        productName,
        applicationVersion,
        userAgent,
      };
      console.log("deviceInfo", deviceInfo);
      setDeviceInfo(deviceInfo);
      // build the browser-like user agent once, as soon as device info is loaded
      setBrowserUserAgent(browserLikeUserAgent(deviceInfo.userAgent));
    } catch (error) {
      console.error("Error getting device info:", error);
    }
  };

  const checkAndRequestReview = async () => {
    console.log(appOpenCount);

    try {
      // Only request review if:
      // 1. The app has been opened at least 5 times
      // 2. It's been at least 7 days since the last review request
      // 3. The device is capable of showing the review dialog
      const now = Date.now();
      const sevenDaysInMs = 7 * 24 * 60 * 60 * 1000;

      if (
        appOpenCount === 5 &&
        (await StoreReview.hasAction()) &&
        (await StoreReview.isAvailableAsync())
      ) {
        await StoreReview.requestReview();
        lastReviewRequest.current = now;
      }
    } catch (error) {
      console.log("Error requesting review:", error);
    }
  };
  async function getId() {
    const id = await AsyncStorage.getItem("subscriptionId");
    console.log(id);
    setsubscriptionID(id);
  }

  useEffect(() => {
    // message to whatsapp
    const handleAppStateChange = (nextAppState: any) => {
      if (
        messages.length > 0 &&
        messagesSent.length < messages.length &&
        nextAppState === "active"
      ) {
        setTimeout(() => {
          // Navigate back to the WebView's initial state or a specific page
          if (webViewRef.current) {
            webViewRef.current.goBack();
          }
          // Proceed to the next message
          setCurrentMessageIndex((prevIndex) => prevIndex + 1);
          sendNextMessage();
        }, 100);
      }
    };

    if (appStateListenerActive) {
      const subscription = AppState.addEventListener(
        "change",
        handleAppStateChange,
      );
      return () => {
        subscription.remove();
      };
    }

    // Handle hardware back press for moving previous page and exit the app

    const reviewSubscription = AppState.addEventListener(
      "change",
      (nextAppState) => {
        if (
          appState.match(/inactive|background/) &&
          nextAppState === "active"
        ) {
          // App has come to the foreground
          setAppOpenCount((prev) => prev + 1);
          checkAndRequestReview();
        }

        setAppState(nextAppState);
      },
    );

    return () => {
      reviewSubscription.remove();
      // Remove event listener when component unmounts
    };
  }, [appOpenCount, appState, messagesSent, currentMessageIndex]);

  useEffect(() => {
    const backAction = () => {
      console.log("canGoBackRef.current:", canGoBackRef.current);
      if (canGoBackRef.current && webViewRef.current) {
        webViewRef.current.goBack();
        lastBackPressRef.current = 0; // Reset timer when going back in WebView
        return true;
      }

      const now = Date.now();
      if (lastBackPressRef.current && now - lastBackPressRef.current < 2000) {
        console.log("Exiting app");
        BackHandler.exitApp(); // exit app on second press
        console.log("Exiting app 2");
        return true;
      }
      ToastAndroid.show("Press back again to exit", ToastAndroid.SHORT);
      lastBackPressRef.current = now;
      return true;
    };

    const backHandler = BackHandler.addEventListener(
      "hardwareBackPress",
      backAction,
    );

    return () => backHandler.remove();
  }, []);

  const parseIntentUrl = (url: string) => {
    // intent://pay?pa=...#Intent;scheme=upi;package=com.xxx;end
    const m = url.match(/^intent:\/\/(.*?)#Intent;(.*)$/i);
    if (!m) return null;
    const scheme = /scheme=([^;]+)/.exec(m[2])?.[1] ?? "https";
    return `${scheme}://${m[1]}`;
  };

  const handleNavigation = (request: { url: string }) => {
    const { url } = request;

    if (/^(upi|tez|phonepe|paytmmp|gpay|credpay|bhim|amazonpay):/i.test(url)) {
      Linking.openURL(url).catch(() =>
        Alert.alert(
          "Payment app unavailable",
          "Please try another payment method.",
        ),
      );
      return false;
    }

    if (/^intent:/i.test(url)) {
      const target = parseIntentUrl(url);
      if (target) Linking.openURL(target).catch(() => {});
      return false;
    }

    return true;
  };

  // wait until device info is ready so the WebView loads with the final UA
  if (!deviceInfo || !browserUserAgent) {
    return (
      <View style={[styles.container, styles.horizontal]}>
        <ActivityIndicator size="large" color="#00ff00" />
      </View>
    );
  }

  const injectScript = `


(function() {
      // Override the function to capture its parameters
      window.WhatsappApi = function(data) {
        if(data){
          const jsonString=data;
          try{
            const parsedJson=JSON.parse(jsonString);
            const modifyData=parsedJson.map(item=>({id:item.id,message:item.Message,number:item.phoneNumber}))
            window.ReactNativeWebView.postMessage("send"+"&SPLIT&"+JSON.stringify(modifyData));
          }
          catch (error){
            console.log("catch error",error)
          }
        }else{
        console.log("data not found")
        }
         
      };
    })();

(function() {
      // Override the function to capture its parameters
      window.sendSMS = function(phone, message) {
        window.ReactNativeWebView.postMessage("sms" + "&SPLIT&" + phone + "&SPLIT&" + message);
      };
    })();
(function() {
      // Override the function to capture its parameters
      window.Share = function(Pdfname, Number,DataRef) {
        window.ReactNativeWebView.postMessage("print" + "&SPLIT&" + DataRef +"&SPLIT&"+ Pdfname +"&SPLIT&"+ Number);
      };
    })();

    (function() {
      // Override the function to capture its parameters
      window.pdfPreview = function(DataRef) {
        window.ReactNativeWebView.postMessage("pdf"+"&SPLIT&"+DataRef);
      };
    })();

    (function() {
      // Override the function to capture its parameters
      window.call = function(DataRef) {
        window.ReactNativeWebView.postMessage("Number"+"&SPLIT&"+DataRef);
      };
    })();

     (function() {
      // Override the function to capture its parameters
      window.popup = function(DataRef,name) {
        window.ReactNativeWebView.postMessage("openLink"+"&SPLIT&"+DataRef+"&SPLIT&"+name);
      };
    })();
    (function() {
      // Override the function to capture its parameters
      window.Screenshot = function() {
        window.ReactNativeWebView.postMessage("Share_pdf"+"&SPLIT&"+window.location.href);
      };
    })();
`;

  const sendMessageSMS = async (message: string, number: string) => {
    try {
      const isAvailable = await SMS.isAvailableAsync();
      if (isAvailable) {
        const { result } = await SMS.sendSMSAsync([number], message);
        console.log("SMS sent successfully", result);
      } else {
        Alert.alert("Error", "SMS is not available on this device");
      }
    } catch (error) {
      console.error("Failed to send SMS", error);
      Alert.alert("Error", "Failed to send SMS");
    }
  };

  // message to whatsapp
  const sendMessageToWhatsApp = async (message: any, number: any) => {
    try {
      let deepLink = `whatsapp://send?text=${encodeURIComponent(message)}`;

      // If a number is provided, add it to the deep link
      if (number) {
        deepLink += `&phone=${number}`;
      }

      await Linking.openURL(deepLink);
    } catch (error: any) {
      console.log("Error sharing to WhatsApp:", error.message);
    }
  };

  const sendNextMessage = async () => {
    // // Normal message sending flow
    if (currentMessageIndex === messages.length) {
      // If the current index is equal to the length of messages array, reset index to 0
      setCurrentMessageIndex(0);
    } else {
      const { message, number } = messages[currentMessageIndex];
      try {
        await sendMessageToWhatsApp(message, number);
        setMessagesSent([...messagesSent, { message, number }]);
        setCurrentMessageIndex(currentMessageIndex + 1);
        setAppStateListenerActive(true); // Activate app state listener after sending a message
      } catch (error: any) {
        console.log("Error sending message:", error.message);
      }
    }
  };

  // convert url to pdfand share without print
  const URLtoShare = async (url: string) => {
    try {
      setDownloadModalVisible(true);

      // Fetch the URL content
      const response = await fetch(url);
      const htmlContent = await response.text();

      // Convert to PDF using Expo Print
      const { uri } = await ExpoPrint.printToFileAsync({
        html: htmlContent,
        width: 612, // Letter size width in points
        height: 792, // Letter size height in points
      });

      setDownloadModalVisible(false);

      // Share directly from generated file URI
      setTimeout(() => {
        sharePDF(uri);
      }, 1000);
    } catch (error) {
      setDownloadModalVisible(false);
      Alert.alert("Error", "Failed to convert and share URL as PDF");
      console.error("Error in URLtoShare:", error);
    }
  };

  const sharePDF = (pdfPath: any) => {
    const shareOptions = {
      // `pdfPath` from Expo Print / FileSystem already has a valid scheme
      url: pdfPath,
      type: "application/pdf",
      title: "Share PDF File",
    };

    Share.open(shareOptions)
      .then((res) => {
        console.log(res);
      })
      .catch((err) => {
        err && console.log(err);
      });
  };
  //   // convert url to pdf and navigate to print page for printing the pdf

  const convertUrlToPdf = async (
    PrintUrl: string,
    name: string,
    number: string,
  ) => {
    try {
      setPrintModalVisible(true);
      const response = await fetch(PrintUrl);
      const htmlContent = await response.text();

      const { uri } = await ExpoPrint.printToFileAsync({
        html: htmlContent,
        width: 612, // Letter size width in points
        height: 792, // Letter size height in points
      });

      setPrintModalVisible(false);
      navigation.navigate("Print", {
        pdfPath: uri,
        name: name,
        number: number,
        url: PrintUrl,
      });
    } catch (error) {
      setPrintModalVisible(false);
      Alert.alert("Error converting URL to PDF", "Please try again!");
      console.log("Error converting URL to PDF:", error);
    }
  };

  //   // for linking the phone app

  const handleLinkPress = (url: any) => {
    // Check if the URL is a phone number link
    if (url.startsWith("tel:")) {
      // Open the phone dialer
      Linking.openURL(url);
      return false;
    }
    return true;
  };

  // Handle messages coming from WebView component for trigger the particular opertaion each operation have different message
  const handleWebViewMessage = (event: any) => {
    const message = event.nativeEvent.data;
    if (message) {
      const [action, index, index1, index2] = message.split("&SPLIT&");
      if (action === "pdf") {
        const pdfURl = index;
        downloadpdf(pdfURl);
      }
      if (action === "sms") {
        sendMessageSMS(index1, index);
      }
      if (action === "send") {
        setmessages(JSON.parse(index));
      }
      if (action === "data") {
        const locationData = JSON.parse(index);
      }

      if (action === "print") {
        convertUrlToPdf(index, index1, index2);
      }
      if (action === "Number") {
        console.log(index);
        handleLinkPress(index);
      }
      if (action === "Share_pdf") {
        URLtoShare(index);
        // navigation.navigate('ApiLogsScreen');
      }
      if (action === "openLink") {
        navigation.navigate("OpenLink", { link: index, name: index1 });
      }
    }
  };
  // handle the download pdf part once the user click the mentioned class name box or anything the pdf is download in user device inside the download directory

  const downloadpdf = async (pdfURl: string) => {
    const fileName = "downloaded_pdf.pdf"; // or derive from URL
    const targetDirectory = new Directory(Paths.document);
    const filePath = `${targetDirectory.uri}/${fileName}`;
    const targetFile = new File(filePath);

    try {
      setDownloadModalVisible(true);

      // Ensure directory exists
      const dirInfo = await targetDirectory.info();
      if (!dirInfo.exists) {
        await targetDirectory.create({ intermediates: true });
      }

      // ✅ Check if the file already exists
      const fileInfo = await targetFile.info();
      if (fileInfo.exists) {
        setDownloadModalVisible(false);
        Alert.alert(
          "Already Downloaded",
          "Do you want to open the existing PDF?",
          [
            { text: "Cancel", style: "cancel" },
            { text: "Open", onPress: () => openPDF(targetFile.uri) },
          ],
        );
        return;
      }

      // Download if not exists
      const encodedUrl = encodeURI(pdfURl.trim());
      const downloadedFile = await File.downloadFileAsync(
        encodedUrl,
        targetFile,
        { headers: { Accept: "application/pdf" } },
      );

      setDownloadModalVisible(false);
      console.log("Finished downloading to:", downloadedFile.uri);
      Alert.alert("Process Completed", "Do you want to open PDF file?", [
        { text: "Cancel", style: "cancel" },
        { text: "Open", onPress: () => openPDF(downloadedFile.uri) },
      ]);
    } catch (error) {
      setDownloadModalVisible(false);
      Alert.alert("Failed to download PDF", "Please try again");
      console.error("Download error:", error);
    }
  };
  // once the pdf is downloaded it asking user to open or share pdf, if the user click the open button it open the pdf in same app in different page.
  const openPDF = (pdfPath: any) => {
    navigation.navigate("PDF", { pdfPath: pdfPath });
  };

  // Razorpay decides from the HTTP User-Agent header, so the browser-like
  // value must be part of the WebView userAgent.
  const userAgent = `${deviceInfo?.applicationBuildVersion}/infogreen-c-app/${deviceInfo?.androidID}/${subscriptionID}/${browserUserAgent}`;

  return (
    <>
      {/* here i am checking the user status for getting the link from api if user status is pending the api doesn't provide the link that case it navigate to bending screen once the status is success it will provid the link and user navigate to webview  */}

      <WebView
        userAgent={userAgent}
        source={{
          uri: "https://user.kongudheeranmanamalai.com/auth-login.php",
        }}
        startInLoadingState
        renderLoading={() => (
          <View style={[styles.container, styles.horizontal]}>
            <ActivityIndicator size="large" color="#00ff00" />
          </View>
        )}
        scalesPageToFit={true}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        cacheEnabled={false}
        incognito={false}
        pullToRefreshEnabled={false}
        showsVerticalScrollIndicator={false}
        ref={webViewRef}
        onNavigationStateChange={(navState) => {
          setCanGoBack(navState.canGoBack);
          canGoBackRef.current = navState.canGoBack; // keep latest value
        }}
        showsHorizontalScrollIndicator={false}
        textZoom={100}
        injectedJavaScript={injectScript}
        onMessage={handleWebViewMessage}
        onShouldStartLoadWithRequest={handleNavigation}
        originWhitelist={["*"]}
        onError={(e) => {
          const { description } = e.nativeEvent;
          console.warn("WebView Error:", description);
          if (description === "net::ERR_INTERNET_DISCONNECTED") {
            navigation.navigate("Network");
          } else {
            Alert.alert("Page Load Error", description, [
              { text: "Retry", onPress: () => webViewRef.current?.reload() },
            ]);
          }
        }}
      />

      <View>
        <Modal
          animationType="slide"
          transparent={true}
          visible={DownloadmodalVisible}
          onRequestClose={() => {
            setDownloadModalVisible(!DownloadmodalVisible);
          }}
        >
          <View>
            <View style={styles.modalView}>
              <ActivityIndicator size="large" color="#00ff00" />
              <Text style={{ color: "black", fontSize: scaleFont(15) }}>
                Please wait your Pdf is Processing
              </Text>
            </View>
          </View>
        </Modal>
      </View>
      {/* for print modal */}
      <View>
        <Modal
          animationType="slide"
          transparent={true}
          visible={PrintmodalVisible}
          onRequestClose={() => {
            setPrintModalVisible(!PrintmodalVisible);
          }}
        >
          <View>
            <View style={styles.modalView}>
              <ActivityIndicator size="large" color="#00ff00" />
              <Text style={{ color: "black", fontSize: scaleFont(15) }}>
                Please wait your Pdf is Generating
              </Text>
            </View>
          </View>
        </Modal>
      </View>
    </>
  );
}
