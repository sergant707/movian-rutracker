/**
 * rutracker.org plugin for Showtime
 *
 *  Copyright (C) 2014-2016 Wain
 *
 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with this program. If not, see <http://www.gnu.org/licenses/>.
 */

(function (plugin) {
    var config = {
        pluginInfo: plugin.getDescriptor(),
        prefix: plugin.getDescriptor().id,
        logo: plugin.path + "logo.png",
        colors: {
            blue: '6699CC',
            orange: 'FFA500',
            red: 'EE0000',
            green: '008B45'
        },
        headers: {
            Connection: "keep-alive",
            Pragma: "no-cache",
            "Cache-Control": "no-cache",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Upgrade-Insecure-Requests": 1,
            "User-Agent": "Mozilla/5.0 (Windows NT 6.3; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/48.0.2564.109 Safari/537.36",
            "Accept-Encoding": "gzip, deflate, sdch",
            "Accept-Language": "ru-RU,ru;q=0.8,en-US;q=0.6,en;q=0.4,und;q=0.2"
        },
        regExps: {
            login: /Вы зашли как:[\s\S]*?<b class="med">([\s\S]*?)<\/b>/g,
            mainCategoryHeader: /<h3 class="cat_title"><a href=".*?">([\s\S]*?)<\/a><\/h3>([\s\S]*?)<\/table>/g,
            mainSubforum: /<h4 class="forumlink"><a href="viewforum\.php\?f=([\s\S]{0,200}?)">([\s\S]*?)<\/a><\/h4>/g,
            topic: /href="viewtopic\.php\?t=([\d]{0,200}?)" class="[\s\S]*?">([\s\S]*?)<\/a>/g,
            userCookie: /bb_session/,
            captcha: /<div><img src="\/\/(.*?)"[.\w\W]*?<input type="hidden" name="cap_sid" value="(.*?)">[.\w\W]*?<input type="text" name="(.*?)"/g,
            authFail: /<div class="logintext">/,
            search: {
                info: /<a class="small tr-dl dl-stub" href=".*?">(.*) &#8595;<\/a>[\W\w.]*?<b class="seedmed">(\d{0,10})<\/b>[\W\w.]*?title="Личи"><b>(\d{0,10})<\/b>/gm,
                name: /<a data-topic_id="(\d{0,10})".*?href="(.*)">(.*)<\/a>/g
            }

        }
    };

    var service = plugin.createService(config.pluginInfo.title, config.prefix + ":start", "video", true, config.logo);
    var settings = plugin.createSettings(config.pluginInfo.title, config.logo, config.pluginInfo.synopsis);
    settings.createInfo("info", config.logo, "Plugin developed by " + config.pluginInfo.author + ". \n");
    settings.createDivider('Settings');
    settings.createString("domain", "Домен", "rutracker.cr", function (v) {
        service.domain = v;
    });

    settings.createString("userCookie", "Cookie пользователя", "DONT_TOUCH_THIS", function (v) {
        service.userCookie = v;
    });

    config.urls = {
        base: 'http://' + service.domain + '/forum/',
        login: 'http://' + service.domain + '/forum/login.php',
        parts: {
            index: 'index.php',
            topic: 'viewtopic.php?t=',
            search: 'tracker.php?nm=',
            subforum: 'viewforum.php?f='
        }
    };

    function coloredStr(str, color) {
        return '<font color="' + color + '">' + str + '</font>';
    }

    function setPageHeader(page, title) {
        if (page.metadata) {
            page.metadata.title = title;
            page.metadata.logo = config.logo;
        }
        page.type = "directory";
        page.contents = "items";
        page.loading = false;
    }


    //Start page
    //There's a list of all forums and subforums being shown
    plugin.addURI(config.prefix + ":start", function (page) {
        var doc,
            loginState, mainSubforum, forumItem, forumTitle;
        setPageHeader(page, config.pluginInfo.synopsis);
        page.loading = true;
        doc = showtime.httpReq(config.urls.base + config.urls.parts.index, {
            headers: config.headers,
            debug: true

        });
        doc.convertFromEncoding('windows-1251').toString();
        page.loading = false;

        //check for LOGIN state
        loginState = config.regExps.login.exec(doc);
        if (!loginState) {
            redirectTo(page, 'login', {showAuth: false});
            return;
        }
        else {
            saveUserCookie(doc.headers);
            if (!(service.userCookie.match(config.regExps.userCookie))) {
                page.redirect(config.prefix + ":logout:false:null:null");
            }

            page.appendItem(config.prefix + ":logout:true:null:null", "directory", {
                title: new showtime.RichText("Выйти из аккаунта " + loginState[1])

            });

        }


        //1-title, 2- HTML contents
        mainSubforum = config.regExps.mainCategoryHeader.exec(doc);
        while (mainSubforum) {
            page.appendItem("", "separator", {
                title: mainSubforum[1]
            });
            // 1-forumId, 2 - title
            forumItem = config.regExps.mainSubforum.exec(mainSubforum[2]);
            while (forumItem) {
                forumTitle = forumItem[2];
                page.appendItem(config.prefix + ":forum:" + forumItem[1] + ':0:' + encodeURIComponent(forumTitle), "directory", {
                    title: new showtime.RichText(forumTitle)
                });
                forumItem = config.regExps.mainSubforum.exec(mainSubforum[2]);
            }

            mainSubforum = config.regExps.mainCategoryHeader.exec(doc);
        }
    });

    //Subforums page. This may contain a list of nested subforums and a list of topics
    plugin.addURI(config.prefix + ":forum:(.*):(.*):(.*)", function (page, forumId, forumPage, forumTitle) {
        var forumItem,
            topicItem,
            topicTitle,
            tryToSearch = true,
            url = config.urls.base + config.urls.parts.subforum + forumId,
            pageNum = 0;

			  setPageHeader(page, decodeURIComponent(forumTitle));
        subforumLoader();
        page.asyncPaginator = subforumLoader;

        function subforumLoader() {
            var response, dom, nextURL, textContent,
                html = require('showtime/html');
            if (!tryToSearch) {
							  return page.haveMore(false);
            }
            page.loading = true;
            response = showtime.httpReq(url, {
                    headers: config.headers,
                    debug: true
                }
            ).convertFromEncoding('windows-1251').toString();
            dom = html.parse(response);
            page.loading = false;
            pageNum++;

            //searching for SUBFORUMS
            forumItem = config.regExps.mainSubforum.exec(response);
            if (forumItem && pageNum === 1) {
                page.appendItem("", "separator", {
                    title: "Форумы"
                });
            }

            while (forumItem) {
                forumTitle = forumItem[2];
                page.appendItem(config.prefix + ":forum:" + forumItem[1] + ':0:' + encodeURIComponent(forumTitle), "directory", {
                    title: new showtime.RichText(forumTitle)
                });
                forumItem = config.regExps.mainSubforum.exec(response);
            }

            //SUBFORUMS ended, add separator

            //searching for TOPICS.
            //1-topicId, 2-topicTitle
            topicItem = config.regExps.topic.exec(response);
            if (topicItem && pageNum === 1) {
                page.appendItem("", "separator", {
                    title: "Темы"
                });
            }
            while (topicItem) {
                topicTitle = topicItem[2];
                //отсеем те темы, которые называются "1". Это не темы на самом деле, а ссылки для перехода на страницу темы,
                //типа "Стр. 1"
                if (topicTitle !== '1') {
                    page.appendItem(config.prefix + ":topic:" + topicItem[1] + ':' + encodeURIComponent(topicTitle), "directory", {
                        title: new showtime.RichText(topicTitle)
                    });
                }
                topicItem = config.regExps.topic.exec(response);
            }

            //try to get the link to the next page
            //pg-jump-menu
            try {
                nextURL = dom.root.getElementByClassName('bottom_info')[0].getElementByClassName('pg');
                nextURL = nextURL[nextURL.length - 1];
                textContent = nextURL.textContent;
                nextURL = nextURL.attributes.getNamedItem('href').value;

                if (!nextURL || textContent !== "След.") {
									  return page.haveMore(false);
                }
                else {
                    url = config.urls.base + nextURL;
									  return page.haveMore(true);
                }
            }
            catch (err) {
							  return page.haveMore(false);
            }
        }
    });


    //Topic
    plugin.addURI(config.prefix + ":topic:(.*):(.*)", function (page, topicId, topicTitle) {
        var doc,
            html = require('showtime/html'),
            pageNum = 0,
            tryToSearch = true,
            url = config.urls.base + config.urls.parts.topic + topicId;
        setPageHeader(page, decodeURIComponent(topicTitle));
        topicLoader();
        page.asyncPaginator = topicLoader;

        function getLink(type, postBody) {
            var link = '', className,
                postImage = null,
                postBodyContents = '',
                redirectState;

            if (type === 'torrent') {
                className = 'dl-link';
            }
            else {
                type = 'magnet';
                className = 'magnet-link-16';
            }

            //trying to get the image
            try {
                if (postBody) {
                    postImage = postBody.getElementByClassName('postImg postImgAligned img-right')[0]
                        .attributes.getNamedItem('title').value;
                    postBodyContents = postBody.textContent || "";
                }
                else {
                    postBodyContents = '';
                }
            }
            catch (err) {
                postBodyContents = '';
            }

            //trying to get link
            try {
                link = postBody.getElementByClassName(className)[0].attributes.getNamedItem('href').value;
            }
            catch (err) {
                link = null;
            }

            if (link) {
                if (type === 'torrent') {
                    redirectState = config.prefix + ':' + type + ':' + encodeURIComponent(link);
                }
                else {
                    type = 'magnet';
                    redirectState = 'torrent:browse:' + decodeURIComponent(link);
                }

                page.appendItem(redirectState, "video", {
                    title: type + ' : ' + decodeURIComponent(topicTitle),
                    icon: postImage,
                    description: new showtime.RichText(postBodyContents)
                });
            }
            else {
                page.appendPassiveItem("video", null, {
                    title: 'Ссылка на .' + type + ' не найдена',
                    icon: postImage,
                    description: new showtime.RichText(postBodyContents)
                });
            }
        }

        function topicLoader() {
            var dom, nextURL, textContent, firstPost,
                postBodies, i, length, commentText,
                html = require('showtime/html');
            if (!tryToSearch) {
							  return page.haveMore(false);
            }
            page.loading = true;
            //проверяем куки, если нет, то нужно перелогиниться или залогиниться, используя сохраненные данные
            if (!(service.userCookie.match(config.regExps.userCookie))) {
                page.redirect(config.prefix + ":logout:false:" + topicId + ":" + topicTitle);
							  return page.haveMore(false);
            }

            doc = showtime.httpReq(url, {
                headers: config.headers
            });
            dom = html.parse(doc);
            page.loading = false;
            pageNum++;

            postBodies = dom.root.getElementByClassName('post_body');
            firstPost = dom.root.getElementByClassName('post_wrap')[0];

            //if we're on the first page, first post must be parsed separately
            if (pageNum === 1) {
                page.appendItem("", "separator", {
                    title: "Ссылки"
                });

                getLink('torrent', firstPost);
                getLink('magnet', firstPost);

                i = 1;
                page.appendItem("", "separator", {
                    title: "Комментарии"
                });
            }
            else {
                i = 0;
            }
            length = postBodies.length;
            for (i; i < length; i++) {
                if (postBodies[i].textContent) {
                    commentText = postBodies[i].textContent;
                    page.appendPassiveItem("video", null, {
                        title: commentText.trim(),
                        description: new showtime.RichText(postBodies[i].textContent)
                    });
                }
            }

            //try to get the link to the next page
            try {
                nextURL = dom.root.getElementByClassName('nav pad_6 row1')[0].getElementByClassName('pg');
                nextURL = nextURL[nextURL.length - 1];
                textContent = nextURL.textContent;
                nextURL = nextURL.attributes.getNamedItem('href').value;

                if (!nextURL || textContent !== "След.") {
									return page.haveMore(false);
                }
                else {
                    url = config.urls.base + nextURL;
									return page.haveMore(true);
                }
            }
            catch (err) {
							  return page.haveMore(false);
            }
        }

    });

    plugin.addURI(config.prefix + ":torrent:(.*)", function (page, dlHref) {
        var http = require('showtime/http'), x;
        dlHref = decodeURIComponent(dlHref);

        if(!~dlHref.indexOf(config.urls.base)) {
            dlHref = config.urls.base + dlHref;
        }

        x = http.request(dlHref, {
            args: {
                dummy: ""
            },
            headers: {
                Cookie: service.userCookie + ' bb_dl=' + dlHref + ';'
            }
        });
        page.redirect('torrent:browse:data:application/x-bittorrent;base64,' + Duktape.enc('base64', x.bytes));
    });

    var redirectTo = function (page, state, stateParams) {
            return page.redirect(config.prefix + ':' + state + ':' + encodeURIComponent(showtime.JSONEncode(stateParams)));
        },

        redirectFrom = function (options) {
            return showtime.JSONDecode(decodeURIComponent(options));
        };

    //Login form
    plugin.addURI(config.prefix + ":login:(.*)", function (page, options) {
        //AUTH!
        var credentials,
            request, response,
            captchaResult;

        //decode options
        options = redirectFrom(options);

        while (1) {
            credentials = plugin.getAuthCredentials(plugin.getDescriptor().synopsis, "Login required", options.showAuth);
            if (credentials.rejected) return; //rejected by user
            if (credentials) {
                page.loading = true;
                request = {
                    postdata: {
                        'login_username': credentials.username,
                        'login_password': credentials.password,
                        'login': encodeURIComponent('Вход')
                    },
                    noFollow: true,
                    headers: {
                        'Referer': config.urls.base,
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Cookie': ''
                    }
                };
                if (options.captchaSid) {
                    request.postdata['cap_sid'] = options.captchaSid;
                    request.postdata[options.capCodeName] = options.captchaValue;
                }
                response = showtime.httpReq(config.urls.login, request);
                page.loading = false;
                saveUserCookie(response.headers);
                captchaResult = config.regExps.captcha.exec(response);
                if (captchaResult) {
                    page.redirect(config.prefix + ":captcha:" + encodeURIComponent(captchaResult[1]) + ":" + captchaResult[2] + ":" + captchaResult[3]);
                    break;
                }
                response = response.toString();
                options.showAuth = response.match(config.regExps.authFail);
                if (!options.showAuth) break;
            }
            options.showAuth = true;
        }

        //AUTH END
        if (options.topicId && options.topicId !== 'null') {
            page.redirect(config.prefix + ":topic:" + options.topicId + ':' + options.topicTitle);
        }
        else page.redirect(config.prefix + ':start');

    });


    plugin.addURI(config.prefix + ":logout:(.*):(.*):(.*)", function (page, showAuth, redirectTopicId, redirectTopicTitle) {
        showtime.httpReq(config.urls.login, {
            postdata: {
                'logout': 1
            },
            noFollow: true,
            debug: true,
            headers: {
                'Referer': config.urls.base + config.urls.parts.index,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });
        page.loading = false;
        redirectTo(page, 'login', {
            showAuth: showAuth === 'true',
            topicId: redirectTopicId,
            topicTitle: redirectTopicTitle
        });
    });

    plugin.addURI(config.prefix + ":captchalogin:(.*):(.*):(.*)", function (page, image, capSid, capCodeName) {
        var captchaValue;

        setPageHeader(page, "Ввод капчи для входа");
        page.appendItem('rutracker:start', "video", {
            title: new showtime.RichText("Капча"),
            icon: 'http://'+decodeURIComponent(image)
        });

        captchaValue = showtime.textDialog("Введите капчу с картинки", true);

        if (captchaValue && !captchaValue.rejected && captchaValue.input) {
            //captcha OK
            //redirect to login with showing creditentials window
            redirectTo(page, 'login', {
                showAuth: true,
                captchaSid: capSid,
                captchaValue: captchaValue.input,
                capCodeName: capCodeName
            })
        }
        else {
            redirectTo(page, 'login', {showAuth: true});
        }
    });


    plugin.addURI(config.prefix + ":captcha:(.*):(.*):(.*)", function (page, image, capSid, capCodeName) {
        setPageHeader(page, "Ввод капчи для входа");
        page.appendItem(config.prefix + ':captchalogin:' + image + ":" + capSid + ":" + capCodeName, "video", {
            title: new showtime.RichText("Нажмите, чтобы ввести капчу"),
            icon: 'http://'+decodeURIComponent(image)
        });
    });

    function saveUserCookie(headers) {
        var cookie;
        if (!headers) return false;
        cookie = headers['Set-Cookie'];
        if (cookie) {
            service.userCookie = cookie.split(';')[0] + ';';
        }
    }

    function performLogin() {
        var credentials = plugin.getAuthCredentials(plugin.getDescriptor().synopsis, "Login required", false),
            response, result;
        if (credentials.rejected) return false; //rejected by user
        if (credentials) {
            response = showtime.httpReq(config.urls.login, {
                postdata: {
                    'login_username': credentials.username,
                    'login_password': credentials.password,
                    'login': encodeURIComponent('Вход')
                },
                noFollow: true,
                headers: {
                    'Referer': config.urls.base,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Cookie': ''
                }
            });
            saveUserCookie(response.headers);
            response = response.toString();
            result = response.match(config.regExps.authFail);
            return !result;
        }
    }


    plugin.addSearcher(plugin.getDescriptor().id, config.logo, function (page, query) {
        var url = config.urls.base + config.urls.parts.search + encodeURIComponent(query),
            nextURL, tryToSearch = false;

        page.entries = 0;
        loader();
        page.asyncPaginator = loader;

        //this is NOT working yet as intended (seems like finding the next page is broken)
        function loader() {
            var response, match, dom, textContent,
                html = require('showtime/html');
            if (!tryToSearch) {
							return page.haveMore(false);
            }
            page.loading = true;
            response = showtime.httpReq(url, {
                headers: config.headers
            }).toString();
            dom = html.parse(response);
            page.loading = false;
            //perform background login if login form has been found on the page
            if (response.match(config.regExps.authFail)) {
                if (!performLogin()) {
                    //do not perform the search if the background login has failed
									return page.haveMore(false);
                }
            }

            match = makeDescription(response);
            //проходимся по найденным темам
            while (match && match.title !== "") {
                page.appendItem(config.prefix + ":topic:" + match.topicId + ":" + encodeURIComponent(match.title), "video", {
                    title: match.titleExtended,
                    description: match.description
                });
                page.entries++;
                match = makeDescription(response);
            }
            try {
                nextURL = dom.root.getElementByClassName('bottom_info')[0].getElementByClassName('pg');
                nextURL = nextURL[nextURL.length - 1];
                textContent = nextURL.textContent;
                nextURL = nextURL.attributes.getNamedItem('href').value;

                if (!nextURL || textContent !== "След.") {
									return page.haveMore(false);
                }
                else {
                    url = config.urls.base + nextURL;
									return page.haveMore(true);
                }
            }
            catch (err) {
							return page.haveMore(true);
            }
        }


        function makeDescription(response) {
            var result = {
                    title: "",
                    href: "",
                    topicId: "",
                    size: "0",
                    seeders: "0",
                    leechers: "0"
                },
                //1-номер темы, 2-относительная ссылка на тему, 3-название
                nameMatch = config.regExps.search.name.exec(response),
                //1-размер, 2-сидеры, 3-личеры
                infoMatch = config.regExps.search.info.exec(response);

            if (nameMatch) {
                result.title = nameMatch[3];
                result.href = nameMatch[2];
                result.topicId = nameMatch[1];
            }
            if (infoMatch) {
                result.size = infoMatch[1];
                result.seeders = infoMatch[2];
                result.leechers = infoMatch[3];
            }
            //сформируем готовую строку с описанием торрента
            result.description = coloredStr('Название: ', config.colors.orange) + result.title + "<br>";
            result.description += coloredStr('Размер: ', config.colors.blue) + result.size + "<br>";
            result.description += coloredStr('Сидеры: ', config.colors.green) + result.seeders + "<br>";
            result.description += coloredStr('Личеры: ', config.colors.red) + result.leechers + "<br>";
            result.description = new showtime.RichText(result.description);

            result.titleExtended = '';
            result.titleExtended += coloredStr(result.size, config.colors.blue) + " (";
            result.titleExtended += coloredStr(result.seeders, config.colors.green) + "/";
            result.titleExtended += coloredStr(result.leechers, config.colors.red)  + ")";
            result.titleExtended += result.title;
            result.titleExtended = new showtime.RichText(result.titleExtended);
            return result;
        }

    });


})(this);
